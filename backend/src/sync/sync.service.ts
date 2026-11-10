import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { CLOCK, type Clock } from '../clock';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config';
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
import {
  EnableBankingClient,
  type EnableBankingBalance,
  type EnableBankingTransaction,
} from '../enable-banking/enable-banking-client';

export type SyncTrigger = 'initial' | 'scheduled' | 'manual';

/** SQLite limits the number of variables in one statement. */
const INSERT_BATCH_SIZE = 50;

type AccountRow = typeof accounts.$inferSelect;

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly enableBanking: EnableBankingClient,
  ) {}

  /** A run cut short by a restart would otherwise show as in progress forever. */
  onModuleInit(): void {
    this.db
      .update(syncRuns)
      .set({ finishedAt: this.now() })
      .where(isNull(syncRuns.finishedAt))
      .run();
  }

  /** Whether a sync is running right now. */
  isSyncing(): boolean {
    return (
      this.db
        .select({ id: syncRuns.id })
        .from(syncRuns)
        .where(isNull(syncRuns.finishedAt))
        .get() !== undefined
    );
  }

  /**
   * Starts a sync and returns once it is recorded as running; the promise resolves when it has
   * finished and never rejects. With a `connectionId` only that connection's accounts are synced,
   * otherwise every account of every connection that has not expired.
   */
  start(trigger: SyncTrigger, connectionId?: number): Promise<void> {
    let runId: number;
    let rows: AccountRow[];
    try {
      const now = this.now();
      rows = this.db
        .select({ account: accounts })
        .from(accounts)
        .innerJoin(connections, eq(accounts.connectionId, connections.id))
        .where(
          connectionId === undefined
            ? gt(connections.validUntil, now)
            : eq(connections.id, connectionId),
        )
        .all()
        .map((row) => row.account);
      runId = this.db
        .insert(syncRuns)
        .values({ trigger, startedAt: now })
        .returning({ id: syncRuns.id })
        .get().id;
    } catch (cause) {
      this.logger.error(`Could not start a ${trigger} sync: ${String(cause)}`);
      return Promise.resolve();
    }
    return this.execute(runId, rows).catch((cause: unknown) =>
      this.logger.error(`Sync ${runId} failed: ${String(cause)}`),
    );
  }

  private async execute(runId: number, rows: AccountRow[]): Promise<void> {
    try {
      for (const account of rows) {
        try {
          await this.syncAccount(runId, account);
        } catch (cause) {
          // One account's storage problem must not stop the others from being synced.
          this.logger.error(`Could not record the sync of account ${account.id}: ${String(cause)}`);
        }
      }
    } finally {
      this.db.update(syncRuns).set({ finishedAt: this.now() }).where(eq(syncRuns.id, runId)).run();
    }
  }

  private async syncAccount(runId: number, account: AccountRow): Promise<void> {
    let fetched: EnableBankingBalance[];
    let fetchedTransactions: EnableBankingTransaction[];
    try {
      fetched = await this.enableBanking.getBalances(account.uid);
      fetchedTransactions = await this.enableBanking.getTransactions(account.uid);
    } catch (cause) {
      this.logger.warn(`Could not fetch data for account ${account.id}: ${String(cause)}`);
      this.db
        .insert(syncAccountResults)
        .values({
          syncRunId: runId,
          accountId: account.id,
          outcome: 'failed',
          error: String(cause),
          syncedAt: this.now(),
        })
        .run();
      return;
    }
    const fetchedAt = this.now();
    this.db.transaction((tx) => {
      if (fetched.length > 0) {
        tx.insert(balances)
          .values(
            fetched.map((balance) => ({
              accountId: account.id,
              type: balance.type,
              amount: normalise(account.type, balance),
              currency: balance.currency,
              referenceDate: balance.referenceDate,
              fetchedAt,
            })),
          )
          .run();
      }
      this.storeTransactions(tx, account, fetchedTransactions, fetchedAt);
      tx.insert(syncAccountResults)
        .values({
          syncRunId: runId,
          accountId: account.id,
          outcome: 'ok',
          error: null,
          syncedAt: fetchedAt,
        })
        .run();
    });
  }

  /**
   * Booked transactions are added unless already stored; pending ones are replaced, since the
   * bank may change or drop them before booking. The dedup rules are provisional.
   */
  private storeTransactions(
    tx: Pick<AppDatabase, 'insert' | 'delete'>,
    account: AccountRow,
    fetched: EnableBankingTransaction[],
    fetchedAt: Date,
  ): void {
    tx.delete(transactions)
      .where(and(eq(transactions.accountId, account.id), eq(transactions.status, 'pending')))
      .run();
    const fetchedDay = localDay(fetchedAt, this.config.timezone);
    const occurrences = new Map<string, number>();
    const rows = fetched.map((transaction) => {
      const date = transaction.bookingDate ?? transaction.valueDate ?? fetchedDay;
      return {
        accountId: account.id,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        bookingDate: transaction.bookingDate,
        valueDate: transaction.valueDate,
        date,
        description: transaction.description,
        entryReference: transaction.entryReference,
        dedupKey: dedupKey(transaction, date, occurrences),
        raw: transaction.raw,
        fetchedAt,
      };
    });
    for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
      tx.insert(transactions)
        .values(rows.slice(start, start + INSERT_BATCH_SIZE))
        .onConflictDoNothing()
        .run();
    }
  }
}

/**
 * Identifies a booked transaction within its account: the bank's `entry_reference`, else a
 * fingerprint of date, amount and description plus how many identical ones came before it in
 * this response. Pending transactions are never compared, so theirs only needs to be filled in.
 */
function dedupKey(
  transaction: EnableBankingTransaction,
  date: string,
  occurrences: Map<string, number>,
): string {
  if (transaction.entryReference !== null) return `ref:${transaction.entryReference}`;
  // Pending ones must not shift the index of booked ones, or a transaction would be stored again
  // under a new key when it books.
  if (transaction.status === 'pending') return `pending:${occurrences.size}:${date}`;
  const fingerprint = JSON.stringify([date, transaction.amount, transaction.description]);
  const index = occurrences.get(fingerprint) ?? 0;
  occurrences.set(fingerprint, index + 1);
  return `fp:${fingerprint}:${index}`;
}

/** The calendar day (`YYYY-MM-DD`) a moment falls on in the owner's timezone. */
function localDay(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short' }).format(moment);
}

/** Card accounts must read negative when money is owed, whichever way the bank signs it. */
function normalise(type: AccountRow['type'], balance: EnableBankingBalance): number {
  if (type !== 'card' || balance.creditDebit === null) return balance.amount;
  const size = Math.abs(balance.amount);
  return balance.creditDebit === 'debit' ? -size : size;
}
