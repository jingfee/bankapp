import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lt, max, or } from 'drizzle-orm';
import type { AccountsResponse, Money, TransactionsResponse } from '@bankapp/shared';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import { accounts, balances, connections, syncAccountResults, transactions } from '../db/schema';
import { SyncService } from '../sync/sync.service';

/**
 * Which balance the overview shows, most preferred first: booked closing, then booked
 * interim, then available. Provisional; revisit once real bank data has been seen.
 */
const BALANCE_PREFERENCE = ['CLBD', 'ITBD', 'ITAV'];

/** How many transactions one page of an account's history holds. */
export const TRANSACTIONS_PAGE_SIZE = 50;

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    private readonly sync: SyncService,
  ) {}

  /** The accounts of every connected bank, grouped by bank. */
  listByBank(): AccountsResponse {
    const rows = this.db
      .select({
        id: accounts.id,
        bank: connections.bankName,
        name: accounts.name,
        type: accounts.type,
      })
      .from(accounts)
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .orderBy(asc(connections.bankName), asc(accounts.name))
      .all();
    const lastSynced = new Map(
      this.db
        .select({ accountId: syncAccountResults.accountId, at: max(syncAccountResults.syncedAt) })
        .from(syncAccountResults)
        .where(eq(syncAccountResults.outcome, 'ok'))
        .groupBy(syncAccountResults.accountId)
        .all()
        .map((row) => [row.accountId, row.at]),
    );
    const shown = this.shownBalances();
    const byBank = new Map<string, AccountsResponse['banks'][number]>();
    for (const { id, bank, name, type } of rows) {
      const group = byBank.get(bank) ?? { bank, accounts: [] };
      group.accounts.push({
        id,
        name,
        type,
        balance: shown.get(id) ?? null,
        lastSyncedAt: lastSynced.get(id)?.toISOString() ?? null,
      });
      byBank.set(bank, group);
    }
    return { banks: [...byBank.values()], syncing: this.sync.isSyncing() };
  }

  /**
   * One page of an account's transactions, newest first. `before` is the `nextCursor` of the
   * previous page; the cursor is a position rather than an offset, so transactions arriving
   * from a sync while the owner scrolls neither repeat nor skip. Undefined for an unknown
   * account, `'bad-cursor'` for a cursor that is not one we handed out.
   */
  listTransactions(
    accountId: number,
    before?: string,
  ): TransactionsResponse | 'bad-cursor' | undefined {
    const account = this.db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        bank: connections.bankName,
      })
      .from(accounts)
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(eq(accounts.id, accountId))
      .get();
    if (account === undefined) return undefined;
    let after = undefined;
    if (before !== undefined) {
      const match = /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(before);
      if (match === null) return 'bad-cursor';
      const [, date, id] = match as unknown as [string, string, string];
      after = or(
        lt(transactions.date, date),
        and(eq(transactions.date, date), lt(transactions.id, Number(id))),
      );
    }
    const rows = this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), after))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(TRANSACTIONS_PAGE_SIZE + 1)
      .all();
    const page = rows.slice(0, TRANSACTIONS_PAGE_SIZE);
    const last = page.at(-1);
    return {
      account: { id: account.id, name: account.name, bank: account.bank, type: account.type },
      transactions: page.map((row) => ({
        id: row.id,
        status: row.status,
        amount: { amount: row.amount, currency: row.currency },
        date: row.date,
        description: row.description,
      })),
      nextCursor: rows.length > page.length && last ? `${last.date}:${last.id}` : null,
    };
  }

  /** The balance of the preferred type from each account's most recent fetch. */
  private shownBalances(): Map<number, Money> {
    const latestFetch = this.db
      .select({ accountId: balances.accountId, at: max(balances.fetchedAt).as('at') })
      .from(balances)
      .groupBy(balances.accountId)
      .as('latest_fetch');
    const rows = this.db
      .select({
        accountId: balances.accountId,
        type: balances.type,
        amount: balances.amount,
        currency: balances.currency,
      })
      .from(balances)
      .innerJoin(
        latestFetch,
        and(eq(balances.accountId, latestFetch.accountId), eq(balances.fetchedAt, latestFetch.at)),
      )
      .orderBy(asc(balances.id))
      .all();
    const shown = new Map<number, Money>();
    const rank = (type: string) => {
      const index = BALANCE_PREFERENCE.indexOf(type);
      return index === -1 ? BALANCE_PREFERENCE.length : index;
    };
    const ranks = new Map<number, number>();
    for (const row of rows) {
      const best = ranks.get(row.accountId) ?? Infinity;
      if (rank(row.type) < best) {
        ranks.set(row.accountId, rank(row.type));
        shown.set(row.accountId, { amount: row.amount, currency: row.currency });
      }
    }
    return shown;
  }
}
