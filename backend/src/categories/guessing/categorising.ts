import { Inject, Injectable } from '@nestjs/common';
import type { TransactionCategory } from '@bankapp/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { CLOCK, type Clock } from '../../clock';
import type { AppDatabase } from '../../db/database';
import { DATABASE } from '../../db/database.module';
import { subcategories, transactions } from '../../db/schema';
import { FollowsPurchase, NoSuchTransaction, UnknownSubcategory } from '../../domain-errors';
import { categoryOf } from '../../transactions/query';
import { normaliseDescription } from './normalise-description';

type Database = Pick<AppDatabase, 'select' | 'update' | 'run'>;

/**
 * Makes every refund carry its purchase's subcategory (ADR 0006): confirmed once the purchase
 * has one, and left for review while the purchase has none.
 */
function refreshRefundCategories(db: Pick<AppDatabase, 'run'>): void {
  db.run(sql`
    UPDATE transactions SET
      subcategory_id = (SELECT p.subcategory_id FROM transactions p WHERE p.id = transactions.offsets_transaction_id),
      category_confirmed = (SELECT p.subcategory_id IS NOT NULL FROM transactions p WHERE p.id = transactions.offsets_transaction_id)
    WHERE offsets_transaction_id IS NOT NULL
      AND (subcategory_id IS NOT (SELECT p.subcategory_id FROM transactions p WHERE p.id = transactions.offsets_transaction_id)
        OR category_confirmed <> (SELECT p.subcategory_id IS NOT NULL FROM transactions p WHERE p.id = transactions.offsets_transaction_id))
  `);
}

/**
 * The only way a transaction's subcategory is written: the owner choosing one, the guesser,
 * Replace and manual transactions all come through here. Each write also brings the offset
 * refunds along (ADR 0006), so no caller has to remember to.
 */
@Injectable()
export class Categorising {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Assigns the owner's chosen subcategory to a transaction as confirmed, or makes it
   * uncategorised for good when `subcategoryId` is null. Returns the category it now has and,
   * when a category was chosen, how many other transactions with the same normalised description
   * were guessed anew to match (ADR 0004). Confirmed transactions are never touched.
   */
  set(
    id: number,
    subcategoryId: number | null,
  ): { category: TransactionCategory | null; updatedSimilar: number } {
    if (subcategoryId !== null && !this.subcategoryExists(this.db, subcategoryId)) {
      throw new UnknownSubcategory();
    }
    return this.db.transaction((tx) => {
      const current = tx
        .select({ offsets: transactions.offsetsTransactionId })
        .from(transactions)
        .where(eq(transactions.id, id))
        .get();
      if (current === undefined) throw new NoSuchTransaction();
      // A kvittad refund follows its purchase; the owner changes the purchase instead.
      if (current.offsets !== null) throw new FollowsPurchase();
      this.confirm(tx, id, subcategoryId);
      const updatedSimilar = subcategoryId === null ? 0 : this.spread(tx, id, subcategoryId);
      return { category: categoryOf(tx, id), updatedSimilar };
    });
  }

  /** Confirms the subcategory (or none) of a transaction as the owner's decision. */
  confirm(db: Database, id: number, subcategoryId: number | null): void {
    db.update(transactions)
      // Removing is the owner's decision too, so the app does not guess the transaction again.
      .set({ subcategoryId, categoryConfirmed: true, categoryConfirmedAt: this.clock.now() })
      .where(eq(transactions.id, id))
      .run();
    this.followPurchases(db);
  }

  /** Stores guessed subcategories, which the owner has yet to confirm. */
  guess(db: Database, guesses: readonly { id: number; subcategoryId: number }[]): void {
    for (const { id, subcategoryId } of guesses) {
      db.update(transactions)
        .set({ subcategoryId, categoryConfirmed: false })
        .where(eq(transactions.id, id))
        .run();
    }
    this.followPurchases(db);
  }

  /** Makes the refunds follow their purchases, after a link or a purchase has changed. */
  followPurchases(db: Pick<AppDatabase, 'run'>): void {
    refreshRefundCategories(db);
  }

  /** Whether a subcategory with this id exists. */
  subcategoryExists(db: Pick<AppDatabase, 'select'>, id: number): boolean {
    return (
      db
        .select({ id: subcategories.id })
        .from(subcategories)
        .where(eq(subcategories.id, id))
        .get() !== undefined
    );
  }

  /**
   * Guesses anew the unconfirmed transactions that share the description of `id`, which has
   * just been confirmed as `subcategoryId`: which is what the guesser's history layer answers for this description from now on.
   * Returns how many changed subcategory.
   */
  private spread(tx: Database, id: number, subcategoryId: number): number {
    const row = tx
      .select({ description: transactions.description })
      .from(transactions)
      .where(eq(transactions.id, id))
      .get()!;
    const target = normaliseDescription(row.description);
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
      .filter((candidate) => normaliseDescription(candidate.description) === target);
    this.guess(
      tx,
      similar.map((candidate) => ({ id: candidate.id, subcategoryId })),
    );
    return similar.filter((candidate) => candidate.subcategoryId !== subcategoryId).length;
  }
}
