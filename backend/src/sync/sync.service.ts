import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, gt, isNull, max } from 'drizzle-orm';
import { CategoryGuesser } from '../categories/guessing/category-guesser';
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
  type EnableBankingAccount,
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

/** A stored transaction's category, as handed from a removed pending row to its replacement. */
type StoredCategory = Pick<
  typeof transactions.$inferSelect,
  'subcategoryId' | 'categoryConfirmed' | 'categoryConfirmedAt'
>;

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
    private readonly guesser: CategoryGuesser,
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
    const fetchedAt = this.now();
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
   * Booked transactions are added unless already stored. A pending transaction keeps its stored
   * row while the bank returns it, and the booked transaction it turns into updates that same
   * row (ADR 0005); one the bank stops returning without a booked match is removed. A removed
   * pending row hands its category to a newly stored twin, if there is one; other new
   * transactions, and pending ones that book without a category, get a guessed category. The matching rules are provisional. Returns how many
   * booked transactions were new.
   */
  private storeTransactions(
    tx: Pick<AppDatabase, 'insert' | 'delete' | 'update' | 'select' | 'run'>,
    account: AccountRow,
    fetched: EnableBankingTransaction[],
    fetchedAt: Date,
  ): number {
    const fetchedDay = localDay(fetchedAt, this.config.timezone);
    const occurrences = new Map<string, number>();
    const pendings = { count: 0 };
    const entries = fetched.map((transaction) => {
      const date =
        transaction.transactionDate ??
        transaction.valueDate ??
        transaction.bookingDate ??
        fetchedDay;
      // Fingerprints must keep using the date they were first made from, or stored transactions
      // would be stored again.
      const dedupDate =
        transaction.bookingDate ??
        transaction.valueDate ??
        transaction.transactionDate ??
        fetchedDay;
      return {
        transaction,
        claimed: false,
        row: {
          accountId: account.id,
          status: transaction.status,
          amount: transaction.amount,
          currency: transaction.currency,
          bookingDate: transaction.bookingDate,
          valueDate: transaction.valueDate,
          transactionDate: transaction.transactionDate,
          date,
          description: transaction.description,
          entryReference: transaction.entryReference,
          dedupKey: dedupKey(transaction, dedupDate, occurrences, pendings),
          raw: transaction.raw,
          fetchedAt,
        },
      };
    });
    const pending = entries.filter((entry) => entry.row.status === 'pending');
    const booked = entries.filter((entry) => entry.row.status === 'booked');

    const stored = tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, account.id), eq(transactions.status, 'pending')))
      .all();
    // Only a pending transaction with an entry reference can be recognised across syncs.
    const identified = stored.filter((row) => row.entryReference !== null);
    const storedByKey = new Map(identified.map((row) => [row.dedupKey, row]));
    const fetchedPendingKeys = new Set(pending.map((entry) => entry.row.dedupKey));
    const kept = new Set<number>();

    // Each booked transaction is the twin of at most one pending one: first the bank's own
    // pending entry, else a stored one the bank no longer returns.
    const merges: { stored: (typeof stored)[number]; booked: (typeof entries)[number] }[] = [];
    for (const entry of booked) {
      const signature = twinSignature(entry.row);
      const twin = pending.find((p) => !p.claimed && twinSignature(p.row) === signature);
      let row = twin ? storedByKey.get(twin.row.dedupKey) : undefined;
      if (twin) twin.claimed = true;
      else {
        row = identified.find(
          (candidate) =>
            !kept.has(candidate.id) &&
            !fetchedPendingKeys.has(candidate.dedupKey) &&
            twinSignature(candidate) === signature,
        );
      }
      if (row && !kept.has(row.id)) {
        kept.add(row.id);
        merges.push({ stored: row, booked: entry });
      }
    }

    // A pending row that is removed hands its category on to the row that replaces it, so a
    // category the owner set is not lost when the pending row cannot be kept.
    const handedOn: { signature: string; category: StoredCategory }[] = [];
    const remove = (row: (typeof stored)[number]) => {
      // Also when the owner removed the category: their twin must not be guessed either.
      if (row.subcategoryId !== null || row.categoryConfirmed) {
        handedOn.push({
          signature: twinSignature(row),
          category: {
            subcategoryId: row.subcategoryId,
            categoryConfirmed: row.categoryConfirmed,
            categoryConfirmedAt: row.categoryConfirmedAt,
          },
        });
      }
      tx.delete(transactions).where(eq(transactions.id, row.id)).run();
    };
    const takeHandedOn = (row: { amount: number; currency: string; description: string }) => {
      const index = handedOn.findIndex((entry) => entry.signature === twinSignature(row));
      return index === -1 ? undefined : handedOn.splice(index, 1)[0]!.category;
    };

    /** Rows without a category the owner decided, to be guessed once stored. */
    const toGuess: number[] = [];
    let added = 0;
    for (const merge of merges) {
      const exists = tx
        .select({ id: transactions.id, categoryConfirmed: transactions.categoryConfirmed })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, account.id),
            eq(transactions.dedupKey, merge.booked.row.dedupKey),
          ),
        )
        .get();
      if (exists) {
        // The booked transaction is already stored, so the pending transaction is just a leftover.
        remove(merge.stored);
        const category = takeHandedOn(merge.stored);
        if (category && !exists.categoryConfirmed) {
          tx.update(transactions).set(category).where(eq(transactions.id, exists.id)).run();
        }
      } else {
        tx.update(transactions)
          .set(merge.booked.row)
          .where(eq(transactions.id, merge.stored.id))
          .run();
        added += 1;
        // The booked description or merchant code may give a guess the pending one did not.
        if (merge.stored.subcategoryId === null && !merge.stored.categoryConfirmed) {
          toGuess.push(merge.stored.id);
        }
      }
    }

    for (const row of stored) {
      if (
        !kept.has(row.id) &&
        !(row.entryReference !== null && fetchedPendingKeys.has(row.dedupKey))
      ) {
        remove(row);
      }
    }
    const inserts: ((typeof entries)[number]['row'] & Partial<StoredCategory>)[] = [];
    for (const entry of entries) {
      if (entry.row.status === 'booked') {
        if (!merges.some((merge) => merge.booked === entry)) {
          inserts.push({ ...entry.row, ...takeHandedOn(entry.row) });
        }
        continue;
      }
      if (entry.claimed) continue;
      const existing = storedByKey.get(entry.row.dedupKey);
      if (existing) {
        tx.update(transactions).set(entry.row).where(eq(transactions.id, existing.id)).run();
      } else {
        inserts.push({ ...entry.row, ...takeHandedOn(entry.row) });
      }
    }
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

/**
 * Banks keep returning a pending transaction alongside the booked transaction it turned into, and may
 * hold a refund as pending with the wrong sign and describe the merchant differently. So two transactions
 * are twins when currency, size of the amount and the description's letters and digits agree.
 */
function twinSignature(row: { amount: number; currency: string; description: string }): string {
  return JSON.stringify([
    Math.abs(row.amount),
    row.currency,
    row.description.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''),
  ]);
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
  pendings: { count: number },
): string {
  if (transaction.entryReference !== null) return `ref:${transaction.entryReference}`;
  // Pending ones must not shift the index of booked ones, or a transaction would be stored again
  // under a new key when it books.
  if (transaction.status === 'pending') return `pending:${pendings.count++}:${date}`;
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
