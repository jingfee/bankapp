import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNull, or } from 'drizzle-orm';
import type {
  BalanceSetting,
  SettlementItem,
  SettlementPeriod,
  SettlementResponse,
} from '@bankapp/shared';
import { effectiveShares } from '../accounts/shares';
import { CLOCK, type Clock, localDay } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { accounts, balanceSettings, categories, subcategories, transactions } from '../db/schema';

/** The subcategory the partner's transfers are categorised as (Överföring › Avräkning delade utgifter). */
export const SETTLEMENT_SUBCATEGORY = 'Avräkning delade utgifter';

/** What a manual transaction shows where an account's name would be. */
export const MANUAL_ACCOUNT_NAME = 'Manuell';

/** Money sums are floats; rounding to öre keeps the noise out of the API. */
const round = (value: number) => Math.round(value * 100) / 100 + 0;

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
    @Inject(CLOCK) private readonly now: Clock,
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

    let running: number | null = null;
    let period = emptyPeriod(0);
    const closed: SettlementPeriod[] = [];
    for (const event of events) {
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
      closed.push({ ...period, closedOn: event.date, paid: event.paid, carriedOut: running });
      period = emptyPeriod(running);
    }
    if (running === null) return { balance: null, periods: [], balanceSettings: [] };
    return {
      balance: running,
      periods: [{ ...period, carriedOut: running }, ...closed.reverse()],
      balanceSettings: made.map(({ amount, asOf }) => ({ amount, asOf })).reverse(),
    };
  }

  /** Today as `YYYY-MM-DD`. */
  today(): string {
    return localDay(this.now());
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
        asOf: asOf ?? localDay(this.now()),
        createdAt: this.now(),
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
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
      .leftJoin(categories, eq(subcategories.categoryId, categories.id))
      .where(
        and(
          or(isNull(transactions.accountId), eq(accounts.hidden, false)),
          gte(transactions.date, from),
          or(isNull(accounts.connectedOn), gte(transactions.date, accounts.connectedOn)),
        ),
      )
      .all();
    const shares = effectiveShares(
      this.db,
      rows.map((row) => row.transaction),
    );
    const events: Event[] = [];
    for (const row of rows) {
      const { transaction } = row;
      const isSettlement =
        row.kind === 'transfer' && row.subcategoryName === SETTLEMENT_SUBCATEGORY;
      if (row.kind === 'transfer' && !isSettlement) continue;
      const share = shares.get(transaction.id)!;
      const paidByPartner = transaction.paidBy === 'partner';
      if (!isSettlement && !paidByPartner && share.percent === 100) continue;
      // The partner's part of what the owner paid; the owner's part of what the partner paid.
      const partnerPart = isSettlement
        ? -transaction.amount
        : paidByPartner
          ? round((transaction.amount * share.percent) / 100)
          : round((-transaction.amount * (100 - share.percent)) / 100);
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
          amount: transaction.amount,
          share: share.option,
          partnerPart,
        },
      });
    }
    return events;
  }
}

function emptyPeriod(carriedIn: number): SettlementPeriod {
  return {
    carriedIn,
    closedOn: null,
    balanceSettings: [],
    items: [],
    paid: 0,
    carriedOut: carriedIn,
  };
}
