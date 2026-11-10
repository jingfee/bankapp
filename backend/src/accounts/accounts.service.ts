import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, max } from 'drizzle-orm';
import type { AccountsResponse, Money } from '@bankapp/shared';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import { accounts, balances, connections, syncAccountResults } from '../db/schema';
import { SyncService } from '../sync/sync.service';

/**
 * Which balance the overview shows, most preferred first: booked closing, then booked
 * interim, then available. Provisional; revisit once real bank data has been seen.
 */
const BALANCE_PREFERENCE = ['CLBD', 'ITBD', 'ITAV'];

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
        name,
        type,
        balance: shown.get(id) ?? null,
        lastSyncedAt: lastSynced.get(id)?.toISOString() ?? null,
      });
      byBank.set(bank, group);
    }
    return { banks: [...byBank.values()], syncing: this.sync.isSyncing() };
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
