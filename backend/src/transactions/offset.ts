import { Inject, Injectable } from '@nestjs/common';
import type { OffsetCandidatesResponse } from '@bankapp/shared';
import { and, desc, eq, gte, isNull, lt, lte, ne, sql, type SQL } from 'drizzle-orm';
import { Categorising } from '../categories/guessing/categorising';
import { normaliseDescription } from '../categories/guessing/normalise-description';
import { CLOCK, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { transactions } from '../db/schema';
import { NoSuchPurchase, NoSuchTransaction, NotLinkable } from '../domain-errors';
import { queryTransactions } from './query';

/** How far before a refund its purchase may be to be suggested. */
const SUGGESTION_WINDOW_DAYS = 90;
const SUGGESTION_LIMIT = 10;
const SEARCH_LIMIT = 30;

const DAY = 86_400_000;

/** Whole days from `from` to `to` (`YYYY-MM-DD`), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

const words = (description: string) =>
  normaliseDescription(description)
    .split(' ')
    .filter((word) => word.length >= 3);

/** 0 when the normalised descriptions are the same, 1 when they share a word, else null. */
function descriptionMatch(refund: string, purchase: string): 0 | 1 | null {
  if (normaliseDescription(refund) === normaliseDescription(purchase)) return 0;
  const theirs = new Set(words(purchase));
  return words(refund).some((word) => theirs.has(word)) ? 1 : null;
}

type Row = typeof transactions.$inferSelect;

/**
 * The rule for linking, defined once. A refund is a booked money-in transaction that is not
 * itself a purchase with refunds; a purchase it can be linked to is a booked, same-currency
 * money-out transaction that is not itself a refund. `link` and `candidates` both use it.
 */
function canBeRefund(refund: Row, hasRefunds: boolean): boolean {
  return refund.amount > 0 && refund.status === 'booked' && !hasRefunds;
}

function linkablePurchase(refund: Row): SQL {
  return and(
    lt(transactions.amount, 0),
    eq(transactions.status, 'booked'),
    eq(transactions.currency, refund.currency),
    isNull(transactions.offsetsTransactionId),
    ne(transactions.id, refund.id),
  )!;
}

/** Offsetting (kvittning) a refund against the purchase it pays back (ADR 0006). */
@Injectable()
export class Offset {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly now: Clock,
    private readonly categorising: Categorising,
  ) {}

  /**
   * Offsets a money-in transaction against the purchase it pays back, or removes the link with
   * `purchaseId` null. The refund takes the purchase's subcategory as confirmed; unlinking
   * leaves it with that category.
   */
  link(id: number, purchaseId: number | null): void {
    this.db.transaction((tx) => {
      const refund = tx.select().from(transactions).where(eq(transactions.id, id)).get();
      if (refund === undefined) throw new NoSuchTransaction();
      if (purchaseId === null) {
        tx.update(transactions)
          .set({ offsetsTransactionId: null })
          .where(eq(transactions.id, id))
          .run();
        return;
      }
      if (
        tx.select().from(transactions).where(eq(transactions.id, purchaseId)).get() === undefined
      ) {
        throw new NoSuchPurchase();
      }
      const hasRefunds =
        tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.offsetsTransactionId, id))
          .get() !== undefined;
      const linkable =
        canBeRefund(refund, hasRefunds) &&
        tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.id, purchaseId), linkablePurchase(refund)))
          .get() !== undefined;
      if (!linkable) throw new NotLinkable();
      tx.update(transactions)
        .set({ offsetsTransactionId: purchaseId, categoryConfirmedAt: this.now() })
        .where(eq(transactions.id, id))
        .run();
      this.categorising.followPurchases(tx);
    });
  }

  /** Purchases a money-in transaction could be offset against; see `OffsetCandidatesResponse`. */
  candidates(id: number, search?: string): OffsetCandidatesResponse {
    const refund = this.db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (refund === undefined) throw new NoSuchTransaction();
    const hasRefunds =
      this.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.offsetsTransactionId, id))
        .get() !== undefined;
    if (!canBeRefund(refund, hasRefunds)) return { transactions: [] };

    const base = linkablePurchase(refund);
    const text = search?.trim() ?? '';
    if (text !== '') {
      const escaped = text.replace(/[\\%_]/g, (c) => `\\${c}`);
      return {
        transactions: queryTransactions(this.db, {
          where: and(base, sql`${transactions.description} LIKE ${`%${escaped}%`} ESCAPE '\\'`),
          orderBy: [desc(transactions.date), desc(transactions.id)],
          limit: SEARCH_LIMIT,
        }),
      };
    }

    const earliest = new Date(Date.parse(refund.date) - SUGGESTION_WINDOW_DAYS * DAY)
      .toISOString()
      .slice(0, 10);
    const rows = queryTransactions(this.db, {
      where: and(
        base,
        gte(transactions.date, earliest),
        lte(transactions.date, refund.date),
        gte(sql`-${transactions.amount}`, refund.amount),
      ),
    });
    const ranked = rows
      .flatMap((transaction) => {
        const match = descriptionMatch(refund.description, transaction.description);
        return match === null ? [] : [{ transaction, match }];
      })
      .sort(
        (a, b) =>
          a.match - b.match ||
          Math.abs(-a.transaction.amount.amount - refund.amount) -
            Math.abs(-b.transaction.amount.amount - refund.amount) ||
          daysBetween(a.transaction.date, refund.date) -
            daysBetween(b.transaction.date, refund.date) ||
          b.transaction.id - a.transaction.id,
      )
      .slice(0, SUGGESTION_LIMIT);
    return { transactions: ranked.map(({ transaction }) => transaction) };
  }
}
