import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/database';
import { normaliseDescription } from '../categories/guessing/normalise-description';

/**
 * Makes every refund carry its purchase's subcategory (ADR 0006): confirmed once the purchase
 * has one, and left for review while the purchase has none. Cheap enough to run after anything
 * that can change a purchase's subcategory.
 */
export function refreshRefundCategories(db: Pick<AppDatabase, 'run'>): void {
  db.run(sql`
    UPDATE transactions SET
      subcategory_id = (SELECT p.subcategory_id FROM transactions p WHERE p.id = transactions.offsets_transaction_id),
      category_confirmed = (SELECT p.subcategory_id IS NOT NULL FROM transactions p WHERE p.id = transactions.offsets_transaction_id)
    WHERE offsets_transaction_id IS NOT NULL
      AND (subcategory_id IS NOT (SELECT p.subcategory_id FROM transactions p WHERE p.id = transactions.offsets_transaction_id)
        OR category_confirmed <> (SELECT p.subcategory_id IS NOT NULL FROM transactions p WHERE p.id = transactions.offsets_transaction_id))
  `);
}

/** How far before a refund its purchase may be to be suggested. */
export const SUGGESTION_WINDOW_DAYS = 90;
export const SUGGESTION_LIMIT = 10;
export const SEARCH_LIMIT = 30;

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
export function descriptionMatch(refund: string, purchase: string): 0 | 1 | null {
  if (normaliseDescription(refund) === normaliseDescription(purchase)) return 0;
  const theirs = new Set(words(purchase));
  return words(refund).some((word) => theirs.has(word)) ? 1 : null;
}
