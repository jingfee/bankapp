import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { CloseMonthRequest, SettlementPeriod, SettlementResponse } from '@bankapp/shared';
import { ReportsService } from '../reports/reports.service';
import { queryTransactions } from '../transactions/query';
import { CLOCK, type Clock } from '../clock';
import type { AppConfig } from '../config/config';
import { APP_CONFIG } from '../config/config.module';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { NoSuchClosedPeriod } from '../domain-errors';
import { balanceSettings, settlementMonths } from '../db/schema';
import { roundOre } from '../transactions/owners-part';
import {
  checkClose,
  checkOpenMonth,
  checkUndoClose,
  replaySettlement,
  type ReplayTransaction,
  type SettlementReplay,
} from './replay';

/** A `settlement_months` row. */
type PeriodRecord = typeof settlementMonths.$inferSelect;

@Injectable()
export class SettlementService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly reports: ReportsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private readonly logger = new Logger(SettlementService.name);

  /**
   * The balance now, its settlement periods and every balance setting, worked out live (ADR 0008).
   * A read never writes: with no period row yet the replay acts as if the first open period
   * existed, and it is stored only when a mutation needs it, so a GET cannot fail on, or race
   * with, a write.
   */
  get(): SettlementResponse {
    return this.withReports(this.replay(this.periodRecords()));
  }

  /** Closes the open period through `closedThrough` and opens `nextMonth` (_Avsluta månad_). */
  async closeMonth(request: Partial<CloseMonthRequest> | undefined): Promise<SettlementResponse> {
    const records = this.periodRecords();
    const { closedThrough, nextMonth } = checkClose(records, request, this.clock.today());
    const closedMonth = this.db.transaction((tx) => {
      const open = this.storeOpenPeriod(tx, records);
      tx.update(settlementMonths)
        .set({ closedThrough })
        .where(eq(settlementMonths.id, open.id))
        .run();
      tx.insert(settlementMonths).values({ month: nextMonth, closedThrough: null }).run();
      return open.month;
    });
    const replayed = this.replay(this.periodRecords());
    // The close stands even when the report cannot be saved; it can be saved again later.
    const closed = this.withReports(replayed).periods.find((p) => p.month === closedMonth);
    if (closed) await this.tryWriteReport(closed);
    return this.withReports(replayed);
  }

  /** Writes the report of the closed period `month` again, with the current figures. */
  async saveReport(month: string): Promise<SettlementResponse> {
    const replayed = this.replay(this.periodRecords());
    const period = this.withReports(replayed).periods.find(
      (p) => p.month === month && p.closedThrough !== null,
    );
    if (!period) throw new NoSuchClosedPeriod(month);
    await this.reports.write(period);
    return this.withReports(replayed);
  }

  /** Writes a closed period's report; a failure is logged, never thrown. */
  private async tryWriteReport(period: SettlementPeriod): Promise<void> {
    try {
      await this.reports.write(period);
    } catch (error) {
      this.logger.error(`Settlement report for ${period.month} failed: ${String(error)}`);
    }
  }

  /** Undoes the latest close: the period it opened is removed and the one it closed reopens. */
  undoClose(): SettlementResponse {
    const records = this.periodRecords();
    checkUndoClose(records);
    const open = records.at(-1)!;
    const latest = records.at(-2)!;
    this.db.transaction((tx) => {
      tx.delete(settlementMonths).where(eq(settlementMonths.id, open.id)).run();
      tx.update(settlementMonths)
        .set({ closedThrough: null })
        .where(eq(settlementMonths.id, latest.id))
        .run();
    });
    this.reports.remove(latest.month);
    return this.get();
  }

  /** Renames the open period, keeping months in strictly increasing order. */
  setOpenMonth(month: unknown): SettlementResponse {
    const records = this.periodRecords();
    const checked = checkOpenMonth(records, month);
    this.db.transaction((tx) => {
      const open = this.storeOpenPeriod(tx, records);
      tx.update(settlementMonths)
        .set({ month: checked })
        .where(eq(settlementMonths.id, open.id))
        .run();
    });
    return this.get();
  }

  /** The stored periods oldest first; the last is the open one. Empty until a mutation stores the first. */
  private periodRecords(): PeriodRecord[] {
    return this.db.select().from(settlementMonths).orderBy(asc(settlementMonths.month)).all();
  }

  /** The open period's row, stored first (for the current month) when no row exists yet. */
  private storeOpenPeriod(tx: Pick<AppDatabase, 'insert'>, records: PeriodRecord[]): PeriodRecord {
    return (
      records.at(-1) ??
      tx
        .insert(settlementMonths)
        .values({ month: this.clock.today().slice(0, 7), closedThrough: null })
        .returning()
        .get()
    );
  }

  /** Loads the facts and replays them (ADRs 0008, 0014); reads and writes nothing else. */
  private replay(records: PeriodRecord[]): SettlementReplay {
    const settings = this.db.select().from(balanceSettings).all();
    return replaySettlement({
      settings,
      transactions: settings.length > 0 ? this.replayTransactions(earliestDay(settings)) : [],
      periods: records,
      today: this.clock.today(),
    });
  }

  /** Marks which closed periods have a report on disk. */
  private withReports(replayed: SettlementReplay): SettlementResponse {
    return {
      ...replayed,
      names: { owner: this.config.ownerName, partner: this.config.partnerName },
      periods: replayed.periods.map((period) => ({
        ...period,
        reportSaved: period.closedThrough === null ? null : this.reports.exists(period.month),
      })),
    };
  }

  /** Today as `YYYY-MM-DD`. */
  today(): string {
    return this.clock.today();
  }

  /** The settlement balance now, or null before the first balance setting. */
  balance(): number | null {
    return this.get().balance;
  }

  /** Records that the balance was `amount` as of `asOf` (today by default); returns the new state. */
  setBalance(amount: number, asOf: string | undefined): SettlementResponse {
    this.db
      .insert(balanceSettings)
      .values({
        amount: roundOre(amount),
        asOf: asOf ?? this.clock.today(),
        createdAt: this.clock.now(),
      })
      .run();
    return this.get();
  }

  /**
   * Every transaction from `from` on, with its share resolved. Transfers other than settlements
   * stay in: which of them move the balance is the replay's rule. Hidden accounts and the days
   * before an account was first connected are left out; pending and uncategorised ones count.
   */
  private replayTransactions(from: string): ReplayTransaction[] {
    return queryTransactions(this.db, { from, sinceConnected: true }).map(
      (row): ReplayTransaction => ({
        id: row.id,
        date: row.date,
        description: row.description,
        amount: row.amount.amount,
        paidBy: row.paidBy,
        status: row.status,
        shareOption: row.share.option,
        sharePercent: row.share.percent,
        kind: row.kind,
        categoryName: row.category?.category.name ?? null,
        subcategoryName: row.category?.subcategory.name ?? null,
        accountName: row.account?.name ?? null,
        icon: row.category?.subcategory.icon ?? null,
        colour: row.category?.category.colour ?? null,
      }),
    );
  }
}

/** The day of the earliest balance setting: nothing before it counts. */
function earliestDay(settings: { asOf: string }[]): string {
  return settings.map((s) => s.asOf).sort()[0]!;
}
