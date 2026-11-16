import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { SyncTrigger } from '@bankapp/shared';
import { and, eq, gt, isNull, max } from 'drizzle-orm';
import { CategoryGuesser } from '../categories/guessing/category-guesser';
import { CLOCK, type Clock } from '../clock';
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
  type EnableBankingAccount,
  type EnableBankingBalance,
  type EnableBankingTransaction,
  type PsuContext,
} from '../enable-banking/enable-banking-client';
import { reconcile } from './reconcile';

export type { SyncTrigger };

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
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly enableBanking: EnableBankingClient,
    private readonly guesser: CategoryGuesser,
  ) {}

  /** A run cut short by a restart would otherwise show as in progress forever. */
  onModuleInit(): void {
    this.db
      .update(syncRuns)
      .set({ finishedAt: this.clock.now() })
      .where(isNull(syncRuns.finishedAt))
      .run();
  }

  /** What started the sync that is running right now, or null when none is. */
  runningSync(): SyncTrigger | null {
    return (
      this.db
        .select({ trigger: syncRuns.trigger })
        .from(syncRuns)
        .where(isNull(syncRuns.finishedAt))
        .get()?.trigger ?? null
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
      const now = this.clock.now();
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
          .set({ finishedAt: this.clock.now() })
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
      this.db
        .update(syncRuns)
        .set({ finishedAt: this.clock.now() })
        .where(eq(syncRuns.id, runId))
        .run();
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
      .values({
        syncRunId: runId,
        accountId: account.id,
        outcome,
        error,
        syncedAt: this.clock.now(),
      })
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
    let details: EnableBankingAccount | undefined;
    let fetched: EnableBankingBalance[];
    let fetchedTransactions: EnableBankingTransaction[];
    try {
      const dateFrom = this.dateFrom(account, initial);
      details = await this.fetchDetails(account, psu);
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
    const fetchedAt = this.clock.now();
    this.db.transaction((tx) => {
      if (details) {
        tx.update(accounts)
          .set({ name: details.name, raw: details.raw })
          .where(eq(accounts.id, account.id))
          .run();
      }
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
   * The account's current details, or undefined when they could not be fetched: the account then
   * keeps its name, since a name is not worth failing a sync for. A rate limit is rethrown, as
   * asking the bank again would not help.
   */
  private async fetchDetails(
    account: AccountRow,
    psu: PsuContext | undefined,
  ): Promise<EnableBankingAccount | undefined> {
    try {
      return await this.enableBanking.getAccountDetails(account.uid, psu ? { psu } : undefined);
    } catch (cause) {
      if (cause instanceof RateLimitError) throw cause;
      this.logger.warn(`Could not fetch details for account ${account.id}: ${String(cause)}`);
      return undefined;
    }
  }

  /**
   * Applies what {@link reconcile} plans for the account's transactions, then guesses a category
   * for each new row the owner decided none for. Returns how many booked transactions were new.
   */
  private storeTransactions(
    tx: Pick<AppDatabase, 'insert' | 'delete' | 'update' | 'select' | 'run'>,
    account: AccountRow,
    fetched: EnableBankingTransaction[],
    fetchedAt: Date,
  ): number {
    const ofAccount = (status: 'pending' | 'booked') =>
      and(eq(transactions.accountId, account.id), eq(transactions.status, status));
    const plan = reconcile(
      {
        pending: tx.select().from(transactions).where(ofAccount('pending')).all(),
        booked: tx
          .select({
            id: transactions.id,
            dedupKey: transactions.dedupKey,
            categoryConfirmed: transactions.categoryConfirmed,
            share: transactions.share,
            replacesTransactionId: transactions.replacesTransactionId,
          })
          .from(transactions)
          .where(ofAccount('booked'))
          .all(),
      },
      fetched,
      this.clock.today(),
    );

    // Removed first: a row that takes over from a removed one may take its manual transaction.
    for (const id of plan.remove) tx.delete(transactions).where(eq(transactions.id, id)).run();
    let added = 0;
    /** Rows without a category the owner decided, to be guessed once stored. */
    const toGuess: number[] = [];
    for (const update of plan.update) {
      tx.update(transactions)
        .set({ ...update.row, fetchedAt })
        .where(eq(transactions.id, update.id))
        .run();
      if (update.newlyBooked) added += 1;
      if (update.guess) toGuess.push(update.id);
    }
    for (const { id, inheritance } of plan.inherit) {
      tx.update(transactions).set(inheritance).where(eq(transactions.id, id)).run();
    }
    const inserts = plan.insert.map((row) => ({ ...row, accountId: account.id, fetchedAt }));
    for (let start = 0; start < inserts.length; start += INSERT_BATCH_SIZE) {
      const inserted = tx
        .insert(transactions)
        .values(inserts.slice(start, start + INSERT_BATCH_SIZE))
        .onConflictDoNothing()
        .returning({
          id: transactions.id,
          status: transactions.status,
          subcategoryId: transactions.subcategoryId,
          categoryConfirmed: transactions.categoryConfirmed,
        })
        .all();
      added += inserted.filter((row) => row.status === 'booked').length;
      toGuess.push(
        ...inserted
          .filter((row) => row.subcategoryId === null && !row.categoryConfirmed)
          .map((row) => row.id),
      );
    }
    this.guesser.guess(tx, toGuess);
    return added;
  }
}

/** Card accounts must read negative when money is owed, whichever way the bank signs it. */
function normalise(type: AccountRow['type'], balance: EnableBankingBalance): number {
  if (type !== 'card' || balance.creditDebit === null) return balance.amount;
  const size = Math.abs(balance.amount);
  return balance.creditDebit === 'debit' ? -size : size;
}
