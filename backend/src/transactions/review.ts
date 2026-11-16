import { Inject, Injectable } from '@nestjs/common';
import type { TransactionReviewResponse } from '@bankapp/shared';
import { and, count, desc, eq, exists, gte, isNotNull, isNull, not, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { transactions } from '../db/schema';
import { onVisibleAccount, queryTransactions } from './query';
import { Replace } from './replace';

/**
 * The first day Att granska asks about (`YYYY-MM-DD`): the app went live in November 2026, and
 * the owner does not want to be reminded to categorise history from before then. Older
 * transactions are still guessed and can still be categorised from their detail page.
 */
export const REVIEW_FROM = '2026-11-01';

const refunds = alias(transactions, 'refunds');

/** What the owner has yet to decide: guessed and uncategorised transactions, and suggested replacements. */
@Injectable()
export class Review {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    private readonly replace: Replace,
  ) {}

  /** Every transaction the owner has yet to confirm, newest first, with how many there are. */
  list(): TransactionReviewResponse {
    const rows = queryTransactions(this.db, {
      where: this.needsReview(),
      orderBy: [desc(transactions.date), desc(transactions.id)],
    });
    const replacements = this.replace.suggestions();
    return { transactions: rows, replacements, count: rows.length + replacements.length };
  }

  /** How many transactions are waiting for review, with the suggested replacements. */
  count(): number {
    const n = this.db.select({ n: count() }).from(transactions).where(this.needsReview()).get()?.n;
    return (n ?? 0) + this.replace.suggestions().length;
  }

  /** Guessed or uncategorised, not yet decided by the owner, and on or after `REVIEW_FROM`. */
  private needsReview() {
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
}
