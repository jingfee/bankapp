import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, lt, max, or } from 'drizzle-orm';
import type {
  AccountsResponse,
  Money,
  RemovedBank,
  SyncSummary,
  TransactionDetails,
  TransactionsResponse,
} from '@bankapp/shared';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import {
  accounts,
  balances,
  connections,
  syncAccountResults,
  syncRuns,
  transactions,
} from '../db/schema';
import { connectionStatus } from '../connections/connection-status';
import { CLOCK, type Clock } from '../clock';
import { NoSuchAccount, InvalidInput } from '../domain-errors';
import { SyncService } from '../sync/sync.service';
import { queryTransactions, summariseTransactions, toListed } from '../transactions/query';
import { filterCondition, type TransactionFilter } from './transaction-filter';
import { loadTransactionDetails } from './transaction-details';

/**
 * Which balance the overview shows, most preferred first: booked closing, then booked
 * interim, then available. Provisional; revisit once real bank data has been seen.
 */
const BALANCE_PREFERENCE = ['CLBD', 'ITBD', 'ITAV'];

/** How many transactions one page of the transaction list holds. */
export const TRANSACTIONS_PAGE_SIZE = 50;

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
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
        closed: accounts.closed,
        hidden: accounts.hidden,
        savings: accounts.savings,
        share: accounts.share,
        validUntil: connections.validUntil,
        removed: connections.removedAt,
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
    const removedBanks = new Map<string, RemovedBank>();
    const now = this.clock.now();
    for (const {
      id,
      bank,
      name,
      type,
      closed,
      hidden,
      savings,
      share,
      validUntil,
      removed,
    } of rows) {
      const account = {
        id,
        name,
        type,
        balance: shown.get(id) ?? null,
        hidden,
        savings,
        share: share ?? ('me' as const),
        lastSyncedAt: lastSynced.get(id)?.toISOString() ?? null,
      };
      if (removed !== null) {
        const group = removedBanks.get(bank) ?? { bank, accounts: [] };
        group.accounts.push(account);
        removedBanks.set(bank, group);
        continue;
      }
      const group = byBank.get(bank) ?? {
        bank,
        status: connectionStatus(validUntil, now),
        validUntil: validUntil.toISOString(),
        accounts: [],
        closedAccounts: [],
      };
      (closed ? group.closedAccounts : group.accounts).push(account);
      byBank.set(bank, group);
    }
    return {
      banks: [...byBank.values()],
      removedBanks: [...removedBanks.values()],
      syncing: this.sync.runningSync(),
      lastSync: this.lastSync(),
    };
  }

  /** Hides or shows an account; hiding a savings account unmarks it. */
  setHidden(id: number, hidden: boolean): void {
    const updated = this.db
      .update(accounts)
      .set(hidden ? { hidden, savings: false } : { hidden })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id })
      .get();
    if (updated === undefined) throw new NoSuchAccount();
  }

  /** Marks an account as a savings account or not; marking a hidden account un-hides it. */
  setSavings(id: number, savings: boolean): void {
    const updated = this.db
      .update(accounts)
      .set(savings ? { savings, hidden: false } : { savings })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id })
      .get();
    if (updated === undefined) throw new NoSuchAccount();
  }

  /** How the most recent finished sync went, or null if none has finished. */
  private lastSync(): SyncSummary | null {
    const run = this.db
      .select({ id: syncRuns.id, finishedAt: syncRuns.finishedAt })
      .from(syncRuns)
      .where(isNotNull(syncRuns.finishedAt))
      .orderBy(desc(syncRuns.id))
      .get();
    if (run?.finishedAt == null) return null;
    const results = this.db
      .select()
      .from(syncAccountResults)
      .where(eq(syncAccountResults.syncRunId, run.id))
      .all();
    return {
      finishedAt: run.finishedAt.toISOString(),
      newTransactions: results.reduce((sum, result) => sum + result.newTransactions, 0),
      failedAccounts: results.filter((result) => result.outcome === 'failed').length,
      rateLimited: results.some((result) => result.outcome === 'rate-limited'),
    };
  }

  /**
   * One page of the transactions of every account, newest first. `before` is the `nextCursor` of
   * the previous page; the cursor is a position rather than an offset, so transactions arriving
   * from a sync while the owner scrolls neither repeat nor skip. A cursor
   * that is not one we handed out is invalid input. `filter` narrows the list, and `count` and `sum` cover every
   * match rather than the page.
   */
  listTransactions(before?: string, filter: TransactionFilter = {}): TransactionsResponse {
    let after = undefined;
    if (before !== undefined) {
      const match = /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(before);
      if (match === null) throw new InvalidInput('The cursor is not valid');
      const [, date, id] = match as unknown as [string, string, string];
      after = or(
        lt(transactions.date, date),
        and(eq(transactions.date, date), lt(transactions.id, Number(id))),
      );
    }
    const rows = queryTransactions(this.db, {
      where: and(filterCondition(filter), after),
      orderBy: [desc(transactions.date), desc(transactions.id)],
      limit: TRANSACTIONS_PAGE_SIZE + 1,
    });
    const totals = summariseTransactions(this.db, { where: filterCondition(filter) });
    const page = rows.slice(0, TRANSACTIONS_PAGE_SIZE);
    const last = page.at(-1);
    return {
      transactions: page.map(toListed),
      nextCursor: rows.length > page.length && last ? `${last.date}:${last.id}` : null,
      count: totals.count,
      sum:
        totals.currencies === 1 && totals.currency !== null
          ? { amount: Math.round(totals.sum * 100) / 100, currency: totals.currency }
          : null,
    };
  }

  /** One transaction in full, or null when there is none with this id (pending ones get a new id when they book). */
  getTransaction(id: number): TransactionDetails | null {
    return loadTransactionDetails(this.db, id);
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
