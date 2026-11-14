import { Inject, Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  not,
  or,
} from 'drizzle-orm';
import type {
  AccountsResponse,
  HouseholdRatioEntry,
  Money,
  OffsetTransaction,
  ShareOption,
  SyncSummary,
  TransactionCategory,
  Transaction,
  TransactionDetails,
  OffsetCandidatesResponse,
  TransactionReviewResponse,
  TransactionsResponse,
} from '@bankapp/shared';
import { DATABASE } from '../db/database.module';
import type { AppDatabase } from '../db/database';
import {
  accounts,
  balances,
  categories,
  connections,
  householdRatios,
  subcategories,
  syncAccountResults,
  syncRuns,
  transactions,
} from '../db/schema';
import { connectionStatus } from '../connections/connection-status';
import { CLOCK, type Clock } from '../clock';
import { SyncService } from '../sync/sync.service';
import { normaliseDescription } from '../categories/guessing/normalise-description';
import {
  categoryColumns,
  onVisibleAccount,
  toCategory,
  toTransaction,
  type ListedRow,
} from './transaction-rows';
import { canChoose, effectiveShares, loadHouseholdRatio } from './shares';
import { parseTransactionDetails } from './transaction-details';
import {
  SEARCH_LIMIT,
  SUGGESTION_LIMIT,
  SUGGESTION_WINDOW_DAYS,
  daysBetween,
  descriptionMatch,
  refreshRefundCategories,
} from './offsets';

/**
 * Which balance the overview shows, most preferred first: booked closing, then booked
 * interim, then available. Provisional; revisit once real bank data has been seen.
 */
const BALANCE_PREFERENCE = ['CLBD', 'ITBD', 'ITAV'];

/**
 * The first day Att granska asks about (`YYYY-MM-DD`): the app went live in November 2026, and
 * the owner does not want to be reminded to categorise history from before then. Older
 * transactions are still guessed and can still be categorised from their detail page.
 */
export const REVIEW_FROM = '2026-11-01';

function toOffsetTransaction(row: typeof transactions.$inferSelect): OffsetTransaction {
  return {
    id: row.id,
    description: row.description,
    amount: { amount: row.amount, currency: row.currency },
    date: row.date,
  };
}

const refunds = alias(transactions, 'refunds');

/** How many transactions one page of the transaction list holds. */
export const TRANSACTIONS_PAGE_SIZE = 50;

@Injectable()
export class AccountsService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly now: Clock,
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
        share: accounts.share,
        validUntil: connections.validUntil,
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
    const now = this.now();
    for (const { id, bank, name, type, closed, hidden, share, validUntil } of rows) {
      const group = byBank.get(bank) ?? {
        bank,
        status: connectionStatus(validUntil, now),
        validUntil: validUntil.toISOString(),
        accounts: [],
        closedAccounts: [],
      };
      (closed ? group.closedAccounts : group.accounts).push({
        id,
        name,
        type,
        balance: shown.get(id) ?? null,
        hidden,
        share: share ?? 'me',
        lastSyncedAt: lastSynced.get(id)?.toISOString() ?? null,
      });
      byBank.set(bank, group);
    }
    return {
      banks: [...byBank.values()],
      syncing: this.sync.isSyncing(),
      lastSync: this.lastSync(),
    };
  }

  /** Hides or shows an account; `'no-account'` when there is none with this id. */
  setHidden(id: number, hidden: boolean): 'ok' | 'no-account' {
    const updated = this.db
      .update(accounts)
      .set({ hidden })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id })
      .get();
    return updated === undefined ? 'no-account' : 'ok';
  }

  /**
   * Sets the share the owner bears of an account's transactions; Jag clears it, so the
   * subcategory's share can apply. Hushåll needs a household ratio first (ADR 0011).
   */
  setShare(id: number, share: ShareOption): 'ok' | 'no-account' | 'no-ratio' {
    if (!canChoose(this.db, share)) return 'no-ratio';
    const updated = this.db
      .update(accounts)
      .set({ share: share === 'me' ? null : share })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id })
      .get();
    return updated === undefined ? 'no-account' : 'ok';
  }

  /** The household ratio, earliest entry first. */
  householdRatio(): HouseholdRatioEntry[] {
    return loadHouseholdRatio(this.db);
  }

  /** Replaces the household ratio with `entries`, which the caller has validated. */
  setHouseholdRatio(entries: HouseholdRatioEntry[]): HouseholdRatioEntry[] {
    this.db.transaction((tx) => {
      tx.delete(householdRatios).run();
      tx.insert(householdRatios).values(entries).run();
    });
    return this.householdRatio();
  }

  /** The listed transactions with their effective shares. */
  private toTransactions(rows: ListedRow[]): Transaction[] {
    const shares = effectiveShares(
      this.db,
      rows.map((row) => row.transaction),
    );
    return rows.map((row) => toTransaction(row, shares.get(row.transaction.id)!));
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
   * from a sync while the owner scrolls neither repeat nor skip. `'bad-cursor'` for a cursor
   * that is not one we handed out.
   */
  listTransactions(before?: string): TransactionsResponse | 'bad-cursor' {
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
      .select({
        transaction: transactions,
        accountName: accounts.name,
        accountType: accounts.type,
        bank: connections.bankName,
        category: categoryColumns,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
      .leftJoin(categories, eq(subcategories.categoryId, categories.id))
      .where(and(onVisibleAccount(this.db), after))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(TRANSACTIONS_PAGE_SIZE + 1)
      .all();
    const page = rows.slice(0, TRANSACTIONS_PAGE_SIZE);
    const last = page.at(-1)?.transaction;
    return {
      transactions: this.toTransactions(page),
      nextCursor: rows.length > page.length && last ? `${last.date}:${last.id}` : null,
    };
  }

  /**
   * The transactions waiting for review: guessed or uncategorised, not yet decided by the owner,
   * and listed on or after `REVIEW_FROM`.
   */
  private get needsReview() {
    return and(
      onVisibleAccount(this.db),
      eq(transactions.categoryConfirmed, false),
      gte(transactions.date, REVIEW_FROM),
      // A refund follows its purchase, so there is nothing to ask about it.
      isNull(transactions.offsetsTransactionId),
      // A purchase that has been offset, and so has a category its refunds follow, is settled.
      not(
        and(
          isNotNull(transactions.subcategoryId),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(refunds)
              .where(eq(refunds.offsetsTransactionId, transactions.id)),
          ),
        )!,
      ),
    );
  }

  /** Every transaction the owner has yet to confirm, newest first, with how many there are. */
  listForReview(): TransactionReviewResponse {
    const rows = this.db
      .select({
        transaction: transactions,
        accountName: accounts.name,
        accountType: accounts.type,
        bank: connections.bankName,
        category: categoryColumns,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
      .leftJoin(categories, eq(subcategories.categoryId, categories.id))
      .where(this.needsReview)
      .orderBy(desc(transactions.date), desc(transactions.id))
      .all();
    return { transactions: this.toTransactions(rows), count: rows.length };
  }

  /** How many transactions are waiting for review. */
  countForReview(): number {
    return this.db.select({ n: count() }).from(transactions).where(this.needsReview).get()?.n ?? 0;
  }

  /** One transaction in full, or null when there is none with this id (pending ones get a new id when they book). */
  getTransaction(id: number): TransactionDetails | null {
    const found = this.db
      .select({
        transaction: transactions,
        accountName: accounts.name,
        accountType: accounts.type,
        bank: connections.bankName,
        category: categoryColumns,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
      .leftJoin(categories, eq(subcategories.categoryId, categories.id))
      .where(and(eq(transactions.id, id), onVisibleAccount(this.db)))
      .get();
    if (found === undefined) return null;
    const { transaction: row, accountName, accountType, bank, category } = found;
    const purchase =
      row.offsetsTransactionId === null ? null : this.offsetTransaction(row.offsetsTransactionId);
    const linked = this.db
      .select()
      .from(transactions)
      .where(eq(transactions.offsetsTransactionId, row.id))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .all();
    return {
      id: row.id,
      status: row.status,
      amount: { amount: row.amount, currency: row.currency },
      description: row.description,
      account: { id: row.accountId, name: accountName, bank, type: accountType },
      category: toCategory(category),
      share: effectiveShares(this.db, [row]).get(row.id)!,
      transactionDate: row.transactionDate,
      bookingDate: row.bookingDate,
      ...parseTransactionDetails(row.raw, row.amount),
      offsets: purchase,
      refunds: linked.map(toOffsetTransaction),
      netAmount:
        linked.length === 0
          ? null
          : {
              amount:
                Math.round((row.amount + linked.reduce((sum, r) => sum + r.amount, 0)) * 100) /
                  100 +
                0,
              currency: row.currency,
            },
      raw: row.raw,
    };
  }

  private offsetTransaction(id: number): OffsetTransaction | null {
    const row = this.db.select().from(transactions).where(eq(transactions.id, id)).get();
    return row === undefined ? null : toOffsetTransaction(row);
  }

  /**
   * Offsets (kvittar) a money-in transaction against the purchase it pays back, or removes the
   * link with `purchaseId` null. The refund takes the purchase's subcategory as confirmed
   * (ADR 0006); unlinking leaves it with that category. Both must be booked, in the same
   * currency, money in and money out, and the purchase must not itself be a refund.
   */
  setOffset(
    id: number,
    purchaseId: number | null,
  ): TransactionDetails | 'no-transaction' | 'no-purchase' | 'not-linkable' {
    const result = this.db.transaction((tx) => {
      const refund = tx.select().from(transactions).where(eq(transactions.id, id)).get();
      if (refund === undefined) return 'no-transaction' as const;
      if (purchaseId === null) {
        tx.update(transactions)
          .set({ offsetsTransactionId: null })
          .where(eq(transactions.id, id))
          .run();
        return 'ok' as const;
      }
      const purchase = tx.select().from(transactions).where(eq(transactions.id, purchaseId)).get();
      if (purchase === undefined) return 'no-purchase' as const;
      const hasRefunds =
        tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.offsetsTransactionId, id))
          .get() !== undefined;
      if (
        refund.amount <= 0 ||
        purchase.amount >= 0 ||
        refund.status !== 'booked' ||
        purchase.status !== 'booked' ||
        refund.currency !== purchase.currency ||
        purchase.offsetsTransactionId !== null ||
        hasRefunds
      ) {
        return 'not-linkable' as const;
      }
      tx.update(transactions)
        .set({ offsetsTransactionId: purchaseId, categoryConfirmedAt: this.now() })
        .where(eq(transactions.id, id))
        .run();
      refreshRefundCategories(tx);
      return 'ok' as const;
    });
    if (result !== 'ok') return result;
    return this.getTransaction(id) ?? 'no-transaction';
  }

  /** Purchases a money-in transaction could be offset against; see `OffsetCandidatesResponse`. */
  offsetCandidates(id: number, search?: string): OffsetCandidatesResponse | 'no-transaction' {
    const refund = this.db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (refund === undefined) return 'no-transaction';
    const text = search?.trim() ?? '';
    const base = and(
      onVisibleAccount(this.db),
      lt(transactions.amount, 0),
      eq(transactions.status, 'booked'),
      eq(transactions.currency, refund.currency),
      isNull(transactions.offsetsTransactionId),
      ne(transactions.id, id),
    );
    const select = () =>
      this.db
        .select({
          transaction: transactions,
          accountName: accounts.name,
          accountType: accounts.type,
          bank: connections.bankName,
          category: categoryColumns,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .innerJoin(connections, eq(accounts.connectionId, connections.id))
        .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
        .leftJoin(categories, eq(subcategories.categoryId, categories.id));

    if (text !== '') {
      const escaped = text.replace(/[\\%_]/g, (c) => `\\${c}`);
      const rows = select()
        .where(and(base, sql`${transactions.description} LIKE ${`%${escaped}%`} ESCAPE '\\'`))
        .orderBy(desc(transactions.date), desc(transactions.id))
        .limit(SEARCH_LIMIT)
        .all();
      return { transactions: this.toTransactions(rows) };
    }

    if (refund.amount <= 0) return { transactions: [] };
    const earliest = new Date(Date.parse(refund.date) - SUGGESTION_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const rows = select()
      .where(
        and(
          base,
          gte(transactions.date, earliest),
          lte(transactions.date, refund.date),
          gte(sql`-${transactions.amount}`, refund.amount),
        ),
      )
      .all();
    const ranked = rows
      .map((row) => ({
        row,
        match: descriptionMatch(refund.description, row.transaction.description),
      }))
      .filter(
        (entry): entry is { row: (typeof rows)[number]; match: 0 | 1 } => entry.match !== null,
      )
      .sort(
        (a, b) =>
          a.match - b.match ||
          Math.abs(-a.row.transaction.amount - refund.amount) -
            Math.abs(-b.row.transaction.amount - refund.amount) ||
          daysBetween(a.row.transaction.date, refund.date) -
            daysBetween(b.row.transaction.date, refund.date) ||
          b.row.transaction.id - a.row.transaction.id,
      )
      .slice(0, SUGGESTION_LIMIT);
    return { transactions: this.toTransactions(ranked.map(({ row }) => row)) };
  }

  /**
   * Assigns the owner's chosen subcategory to a transaction as confirmed, or makes it
   * uncategorised for good when `subcategoryId` is null. Returns the category it now has and,
   * when a category was chosen, how many other transactions with the same normalised description
   * were guessed anew to match (ADR 0004). Confirmed transactions are never touched.
   */
  setCategory(
    id: number,
    subcategoryId: number | null,
  ):
    | { category: TransactionCategory | null; updatedSimilar: number }
    | 'no-transaction'
    | 'no-subcategory'
    | 'offset' {
    if (
      subcategoryId !== null &&
      this.db
        .select({ id: subcategories.id })
        .from(subcategories)
        .where(eq(subcategories.id, subcategoryId))
        .get() === undefined
    ) {
      return 'no-subcategory';
    }
    return this.db.transaction((tx) => {
      const current = tx
        .select({ offsets: transactions.offsetsTransactionId })
        .from(transactions)
        .where(eq(transactions.id, id))
        .get();
      if (current === undefined) return 'no-transaction' as const;
      // A kvittad refund follows its purchase; the owner changes the purchase instead.
      if (current.offsets !== null) return 'offset' as const;
      const updated = tx
        .update(transactions)
        // Removing is the owner's decision too, so the app does not guess the transaction again.
        .set({ subcategoryId, categoryConfirmed: true, categoryConfirmedAt: this.now() })
        .where(eq(transactions.id, id))
        .returning({ id: transactions.id, description: transactions.description })
        .get();
      if (updated === undefined) return 'no-transaction' as const;

      let updatedSimilar = 0;
      if (subcategoryId !== null) {
        // What the guesser's history layer would answer now: the subcategory just confirmed.
        const target = normaliseDescription(updated.description);
        const similar = tx
          .select({
            id: transactions.id,
            description: transactions.description,
            subcategoryId: transactions.subcategoryId,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.categoryConfirmed, false),
              ne(transactions.id, id),
              isNull(transactions.offsetsTransactionId),
            ),
          )
          .all()
          .filter((row) => normaliseDescription(row.description) === target);
        for (const row of similar) {
          tx.update(transactions).set({ subcategoryId }).where(eq(transactions.id, row.id)).run();
          if (row.subcategoryId !== subcategoryId) updatedSimilar += 1;
        }
      }

      refreshRefundCategories(tx);
      const row = tx
        .select(categoryColumns)
        .from(transactions)
        .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
        .leftJoin(categories, eq(subcategories.categoryId, categories.id))
        .where(eq(transactions.id, id))
        .get();
      return { category: row ? toCategory(row) : null, updatedSimilar };
    });
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
