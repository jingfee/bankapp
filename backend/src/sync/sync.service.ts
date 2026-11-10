import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, gt, isNull, max } from 'drizzle-orm';
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
  RateLimitError,
  type EnableBankingBalance,
  type EnableBankingTransaction,
  type PsuContext,
} from '../enable-banking/enable-banking-client';

export type SyncTrigger = 'initial' | 'scheduled' | 'manual';

/**
 * How many days before the last booked transaction a sync starts fetching again. Pending
 * transactions are dated by the bank on booking, so the overlap catches those that book late.
 */
export const OVERLAP_DAYS = 7;

export interface SyncOptions {
  /** Sync only this connection's accounts, otherwise every connection that has not expired. */
  connectionId?: number;
  /** The owner's device, sent to the bank for a manual sync so it counts as user-present. */
  psu?: PsuContext;
}

/** SQLite limits the number of variables in one statement. */
const INSERT_BATCH_SIZE = 50;

type AccountRow = typeof accounts.$inferSelect;

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);
  /** The sync running in this process, if any. */
  private current: Promise<void> | undefined;

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
   * finished and never rejects. Only one sync runs at a time: while one is running, nothing is
   * started and `started` is false.
   */
  start(
    trigger: SyncTrigger,
    options: SyncOptions = {},
  ): { started: boolean; finished: Promise<void> } {
    let runId: number | undefined;
    let rows: AccountRow[];
    try {
      const now = this.now();
      const claimed = this.db.transaction((tx) => {
        if (
          tx.select({ id: syncRuns.id }).from(syncRuns).where(isNull(syncRuns.finishedAt)).get()
        ) {
          return undefined;
        }
        return tx
          .insert(syncRuns)
          .values({ trigger, startedAt: now })
          .returning({ id: syncRuns.id })
          .get().id;
      });
      if (claimed === undefined)
        return { started: false, finished: this.afterCurrent(trigger, options) };
      runId = claimed;
      rows = this.db
        .select({ account: accounts })
        .from(accounts)
        .innerJoin(connections, eq(accounts.connectionId, connections.id))
        .where(
          and(
            eq(accounts.closed, false),
            options.connectionId === undefined
              ? gt(connections.validUntil, now)
              : eq(connections.id, options.connectionId),
          ),
        )
        .all()
        .map((row) => row.account);
    } catch (cause) {
      this.logger.error(`Could not start a ${trigger} sync: ${String(cause)}`);
      if (runId !== undefined) {
        this.db
          .update(syncRuns)
          .set({ finishedAt: this.now() })
          .where(eq(syncRuns.id, runId))
          .run();
      }
      return { started: false, finished: Promise.resolve() };
    }
    const psu = trigger === 'manual' ? options.psu : undefined;
    const id = runId;
    const finished = this.execute(id, rows, trigger === 'initial', psu).catch((cause: unknown) =>
      this.logger.error(`Sync ${id} failed: ${String(cause)}`),
    );
    this.current = finished;
    return { started: true, finished };
  }

  /**
   * A new connection's first sync must not be lost because another sync was running when the
   * connection was made, so it waits its turn. Other syncs are simply not started.
   */
  private afterCurrent(trigger: SyncTrigger, options: SyncOptions): Promise<void> {
    if (trigger !== 'initial' || this.current === undefined) return Promise.resolve();
    return this.current.then(() => this.start(trigger, options).finished);
  }

  private async execute(
    runId: number,
    rows: AccountRow[],
    initial: boolean,
    psu: PsuContext | undefined,
  ): Promise<void> {
    /** Connections whose bank has refused for asking too often; asking again would not help. */
    const rateLimited = new Set<number>();
    try {
      for (const account of rows) {
        try {
          if (rateLimited.has(account.connectionId)) {
            this.recordFailure(runId, account, 'rate-limited', 'The bank was asked too often');
            continue;
          }
          const outcome = await this.syncAccount(runId, account, initial, psu);
          if (outcome === 'rate-limited') rateLimited.add(account.connectionId);
        } catch (cause) {
          // One account's storage problem must not stop the others from being synced.
          this.logger.error(`Could not record the sync of account ${account.id}: ${String(cause)}`);
        }
      }
    } finally {
      this.db.update(syncRuns).set({ finishedAt: this.now() }).where(eq(syncRuns.id, runId)).run();
    }
  }

  private recordFailure(
    runId: number,
    account: AccountRow,
    outcome: 'failed' | 'rate-limited',
    error: string,
  ): void {
    this.db
      .insert(syncAccountResults)
      .values({ syncRunId: runId, accountId: account.id, outcome, error, syncedAt: this.now() })
      .run();
  }

  /** Where to start fetching transactions; undefined means as far back as the bank allows. */
  private dateFrom(account: AccountRow, initial: boolean): string | undefined {
    if (initial) return undefined;
    const lastBooked = this.db
      .select({ date: max(transactions.bookingDate) })
      .from(transactions)
      .where(and(eq(transactions.accountId, account.id), eq(transactions.status, 'booked')))
      .get()?.date;
    if (!lastBooked) return undefined;
    const day = new Date(`${lastBooked}T00:00:00.000Z`);
    day.setUTCDate(day.getUTCDate() - OVERLAP_DAYS);
    return day.toISOString().slice(0, 10);
  }

  private async syncAccount(
    runId: number,
    account: AccountRow,
    initial: boolean,
    psu: PsuContext | undefined,
  ): Promise<'ok' | 'failed' | 'rate-limited'> {
    let fetched: EnableBankingBalance[];
    let fetchedTransactions: EnableBankingTransaction[];
    try {
      const dateFrom = this.dateFrom(account, initial);
      fetched = await this.enableBanking.getBalances(account.uid, psu ? { psu } : undefined);
      fetchedTransactions = await this.enableBanking.getTransactions(account.uid, {
        ...(dateFrom ? { dateFrom } : {}),
        ...(psu ? { psu } : {}),
      });
    } catch (cause) {
      this.logger.warn(`Could not fetch data for account ${account.id}: ${String(cause)}`);
      const outcome = cause instanceof RateLimitError ? 'rate-limited' : 'failed';
      this.recordFailure(runId, account, outcome, String(cause));
      return outcome;
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
      const newTransactions = this.storeTransactions(tx, account, fetchedTransactions, fetchedAt);
      tx.insert(syncAccountResults)
        .values({
          syncRunId: runId,
          accountId: account.id,
          outcome: 'ok',
          error: null,
          newTransactions,
          syncedAt: fetchedAt,
        })
        .run();
    });
    return 'ok';
  }

  /**
   * Booked transactions are added unless already stored; pending ones are replaced, since the
   * bank may change or drop them before booking. The dedup rules are provisional. Returns how
   * many booked transactions were new.
   */
  private storeTransactions(
    tx: Pick<AppDatabase, 'insert' | 'delete'>,
    account: AccountRow,
    fetched: EnableBankingTransaction[],
    fetchedAt: Date,
  ): number {
    tx.delete(transactions)
      .where(and(eq(transactions.accountId, account.id), eq(transactions.status, 'pending')))
      .run();
    const fetchedDay = localDay(fetchedAt, this.config.timezone);
    const occurrences = new Map<string, number>();
    const rows = withoutBookedTwins(fetched).map((transaction) => {
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
    let added = 0;
    for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
      const inserted = tx
        .insert(transactions)
        .values(rows.slice(start, start + INSERT_BATCH_SIZE))
        .onConflictDoNothing()
        .returning({ status: transactions.status })
        .all();
      added += inserted.filter((row) => row.status === 'booked').length;
    }
    return added;
  }
}

/**
 * Banks keep returning a reservation alongside the booked transaction it turned into. Drops each
 * pending transaction that has a booked twin (same amount, currency and description) in the same
 * response; every booked transaction is the twin of at most one pending one.
 */
function withoutBookedTwins(fetched: EnableBankingTransaction[]): EnableBankingTransaction[] {
  const twin = (transaction: EnableBankingTransaction) =>
    JSON.stringify([
      transaction.amount,
      transaction.currency,
      transaction.description.trim().toLowerCase(),
    ]);
  const booked = new Map<string, number>();
  for (const transaction of fetched) {
    if (transaction.status === 'booked') {
      booked.set(twin(transaction), (booked.get(twin(transaction)) ?? 0) + 1);
    }
  }
  return fetched.filter((transaction) => {
    if (transaction.status !== 'pending') return true;
    const left = booked.get(twin(transaction)) ?? 0;
    if (left === 0) return true;
    booked.set(twin(transaction), left - 1);
    return false;
  });
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
