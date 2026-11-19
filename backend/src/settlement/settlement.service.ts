import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNotNull, isNull, or } from 'drizzle-orm';
import type {
  BalanceSetting,
  CategoryColour,
  CategoryIcon,
  CloseMonthRequest,
  SettlementItem,
  SettlementPeriod,
  SettlementResponse,
} from '@bankapp/shared';
import { effectiveShares, ownerPart, roundOre } from '../transactions/shares';
import { onVisibleAccount } from '../transactions/query';
import { CLOCK, type Clock, isDay } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import {
  accounts,
  balanceSettings,
  categories,
  settlementMonths,
  subcategories,
  transactions,
} from '../db/schema';

/** The subcategory the partner's transfers are categorised as (Överföring › Avräkning delade utgifter). */
export const SETTLEMENT_SUBCATEGORY = 'Avräkning delade utgifter';

/** What a manual transaction shows where an account's name would be. */
export const MANUAL_ACCOUNT_NAME = 'Manuell';

/** Money sums are floats; rounding to öre (half away from zero, like the owner's part) keeps the noise out of the API. */
const round = roundOre;

/** What the replay of one transaction needs: where it falls and what it adds to the balance. */
interface Event {
  date: string;
  /** A balance setting comes before the transactions of its day. */
  order: 0 | 1;
  id: number;
  setting?: BalanceSetting;
  item?: SettlementItem;
  /** Set for a settlement: what it paid. */
  paid?: number;
}

@Injectable()
export class SettlementService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The balance now, its settlement periods and every balance setting, worked out live (ADR 0008). */
  get(): SettlementResponse {
    const made = this.db.select().from(balanceSettings).orderBy(asc(balanceSettings.id)).all();
    // The latest setting made wins: it replaces every earlier one from its day on.
    const settings: typeof made = [];
    for (const setting of made) {
      settings.splice(
        0,
        settings.length,
        ...settings.filter((s) => s.asOf < setting.asOf),
        setting,
      );
    }
    const events: Event[] = settings.map((setting) => ({
      date: setting.asOf,
      order: 0,
      id: setting.id,
      setting: { amount: setting.amount, asOf: setting.asOf },
    }));
    if (settings.length > 0) events.push(...this.transactionEvents(settings[0]!.asOf));
    events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id - b.id);

    const rows = this.periodRows();
    const today = this.clock.today();
    let running: number | null = null;
    let index = 0;
    let period = emptyPeriod(rows[0]!, 0, today);
    const built: SettlementPeriod[] = [];
    /** Ends the current period and starts the next one, which carries the balance on. */
    const closeCurrent = () => {
      built.push({ ...period, carriedOut: running ?? 0 });
      index += 1;
      period = emptyPeriod(rows[index]!, running ?? 0, today);
    };
    /** Moves on past every closed period that ended before `date`. */
    const advanceTo = (date: string) => {
      while (rows[index]!.closedThrough !== null && date > rows[index]!.closedThrough!) {
        closeCurrent();
      }
    };
    for (const event of events) {
      advanceTo(event.date);
      if (event.setting) {
        running = event.setting.amount;
        period.balanceSettings.push(event.setting);
        continue;
      }
      const item = event.item!;
      if (running === null) continue;
      running = round(running + item.partnerPart);
      if (event.paid === undefined) {
        period.items.push(item);
        continue;
      }
      period.payments.push({
        transactionId: item.transactionId,
        date: item.date,
        amount: event.paid,
      });
      period.paid = round(period.paid + event.paid);
    }
    if (running === null) return { balance: null, periods: [], balanceSettings: [] };
    while (index < rows.length - 1) closeCurrent();
    built.push({ ...period, carriedOut: running });
    return {
      balance: running,
      periods: built.reverse(),
      balanceSettings: made.map(({ amount, asOf }) => ({ amount, asOf })).reverse(),
    };
  }

  /** Closes the open period through `closedThrough` and opens `nextMonth` (_Avsluta månad_). */
  closeMonth(request: Partial<CloseMonthRequest> | undefined): SettlementResponse {
    const { closedThrough, nextMonth } = request ?? {};
    if (typeof closedThrough !== 'string' || !isDay(closedThrough)) {
      throw new BadRequestException('closedThrough must be a day as YYYY-MM-DD');
    }
    if (typeof nextMonth !== 'string' || !isMonth(nextMonth)) {
      throw new BadRequestException('nextMonth must be a month as YYYY-MM');
    }
    if (closedThrough > this.clock.today()) {
      throw new BadRequestException('closedThrough cannot be in the future');
    }
    const rows = this.periodRows();
    const open = rows.at(-1)!;
    const previous = rows.at(-2)?.closedThrough;
    if (previous && closedThrough < previous) {
      throw new BadRequestException(
        `closedThrough cannot be before the previous close, ${previous}`,
      );
    }
    if (nextMonth <= open.month) {
      throw new BadRequestException(`nextMonth must be later than ${open.month}`);
    }
    this.db.transaction((tx) => {
      tx.update(settlementMonths)
        .set({ closedThrough })
        .where(eq(settlementMonths.id, open.id))
        .run();
      tx.insert(settlementMonths).values({ month: nextMonth, closedThrough: null }).run();
    });
    return this.get();
  }

  /** Undoes the latest close: the period it opened is removed and the one it closed reopens. */
  undoClose(): SettlementResponse {
    const rows = this.periodRows();
    if (rows.length < 2) throw new BadRequestException('there is no close to undo');
    const open = rows.at(-1)!;
    const latest = rows.at(-2)!;
    this.db.transaction((tx) => {
      tx.delete(settlementMonths).where(eq(settlementMonths.id, open.id)).run();
      tx.update(settlementMonths)
        .set({ closedThrough: null })
        .where(eq(settlementMonths.id, latest.id))
        .run();
    });
    return this.get();
  }

  /** Renames the open period, keeping months in strictly increasing order. */
  setOpenMonth(month: unknown): SettlementResponse {
    if (typeof month !== 'string' || !isMonth(month)) {
      throw new BadRequestException('month must be a month as YYYY-MM');
    }
    const rows = this.periodRows();
    const previous = rows.at(-2);
    if (previous && month <= previous.month) {
      throw new BadRequestException(`month must be later than ${previous.month}`);
    }
    this.db
      .update(settlementMonths)
      .set({ month })
      .where(eq(settlementMonths.id, rows.at(-1)!.id))
      .run();
    return this.get();
  }

  /** The periods oldest first; the last is the open one, created for the current month when missing. */
  private periodRows(): (typeof settlementMonths.$inferSelect)[] {
    const rows = this.db.select().from(settlementMonths).orderBy(asc(settlementMonths.month)).all();
    if (rows.length > 0) return rows;
    return this.db
      .insert(settlementMonths)
      .values({ month: this.clock.today().slice(0, 7), closedThrough: null })
      .returning()
      .all();
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
        amount: round(amount),
        asOf: asOf ?? this.clock.today(),
        createdAt: this.clock.now(),
      })
      .run();
    return this.get();
  }

  /**
   * Every transaction from `from` on that moves the balance: the partner's part of shared ones
   * and the settlements. Transfers, hidden accounts and the days before an account was first
   * connected are left out; pending and uncategorised ones count.
   */
  private transactionEvents(from: string): Event[] {
    const rows = this.db
      .select({
        transaction: transactions,
        accountName: accounts.name,
        connectedOn: accounts.connectedOn,
        kind: categories.kind,
        subcategoryName: subcategories.name,
        subcategoryIcon: subcategories.icon,
        categoryColour: categories.colour,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
      .leftJoin(categories, eq(subcategories.categoryId, categories.id))
      .where(and(onVisibleAccount(this.db), gte(transactions.date, from), connectedBefore()))
      .all();
    const shares = effectiveShares(
      this.db,
      rows.map((row) => row.transaction),
    );
    const events: Event[] = [];
    for (const row of rows) {
      const { transaction } = row;
      if (!movesBalance(row.kind, row.subcategoryName)) continue;
      const isSettlement = row.kind === 'transfer';
      const share = shares.get(transaction.id)!;
      const paidByPartner = transaction.paidBy === 'partner';
      if (!isSettlement && !paidByPartner && share.percent === 100) continue;
      // The partner's part of what the owner paid; the owner's part of what the partner paid.
      const ownersPart = ownerPart(transaction.amount, share.percent);
      const partnerPart = isSettlement
        ? -transaction.amount
        : paidByPartner
          ? ownersPart
          : round(ownersPart - transaction.amount);
      events.push({
        date: transaction.date,
        order: 1,
        id: transaction.id,
        paid: isSettlement ? transaction.amount : undefined,
        item: {
          transactionId: transaction.id,
          date: transaction.date,
          description: transaction.description,
          accountName: row.accountName ?? MANUAL_ACCOUNT_NAME,
          icon: row.subcategoryIcon as CategoryIcon | null,
          colour: row.categoryColour as CategoryColour | null,
          amount: transaction.amount,
          share: share.option,
          partnerPart,
        },
      });
    }
    return events;
  }
}

/**
 * Days before an account was first connected are left out, unless the transaction replaces a
 * manual one: it stands in for that and so counts even when dated earlier (ADR 0009).
 */
function connectedBefore() {
  return or(
    isNull(accounts.connectedOn),
    gte(transactions.date, accounts.connectedOn),
    isNotNull(transactions.replacesTransactionId),
  );
}

/** Among transfers only the settlements (Avräkning) move the balance. */
function movesBalance(kind: string | null, subcategoryName: string | null): boolean {
  return kind !== 'transfer' || subcategoryName === SETTLEMENT_SUBCATEGORY;
}

function emptyPeriod(
  row: typeof settlementMonths.$inferSelect,
  carriedIn: number,
  today: string,
): SettlementPeriod {
  return {
    month: row.month,
    closedThrough: row.closedThrough,
    carriedIn,
    balanceSettings: [],
    items: [],
    payments: [],
    paid: 0,
    carriedOut: carriedIn,
    overdue: row.closedThrough === null && endedDaysAgo(row.month, today) >= 7,
  };
}

function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Whole days from the last day of `month` to `today` (negative while the month is running). */
function endedDaysAgo(month: string, today: string): number {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const lastDay = Date.UTC(year, number, 0);
  return Math.round((Date.parse(`${today}T00:00:00Z`) - lastDay) / 86_400_000);
}
