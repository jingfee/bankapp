import { desc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db/database';
import { transactions } from '../../db/schema';
import { normaliseDescription } from './normalise-description';

/** The most recently confirmed subcategory for each normalised description. */
export function categoryHistory(db: Pick<AppDatabase, 'select'>): Map<string, number> {
  const rows = db
    .select({ description: transactions.description, subcategoryId: transactions.subcategoryId })
    .from(transactions)
    .where(eq(transactions.categoryConfirmed, true))
    .orderBy(
      sql`${transactions.categoryConfirmedAt} IS NULL`,
      desc(transactions.categoryConfirmedAt),
      desc(transactions.id),
    )
    .all();
  const history = new Map<string, number>();
  for (const { description, subcategoryId } of rows) {
    const key = normaliseDescription(description);
    if (subcategoryId !== null && !history.has(key)) history.set(key, subcategoryId);
  }
  return history;
}
