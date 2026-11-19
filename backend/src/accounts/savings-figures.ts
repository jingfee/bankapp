import { and, eq, lte } from 'drizzle-orm';
import type { AppDatabase } from '../db/database';
import { transactions } from '../db/schema';

/** What a savings account's balance is made of on a day (`CONTEXT.md` › Savings). */
export interface SavingsFigures {
  /** Deposits minus withdrawals up to the day, interest not counted. */
  netDeposits: number;
  /** The balance minus net deposits; negative when the account lost value. */
  growth: number;
}

/** A transaction describing interest ("ränta", any case) is growth, not a deposit. */
const isInterest = (description: string) => description.toLowerCase().includes('ränta');

/**
 * Net deposits and growth of a connected savings account on `day` (`YYYY-MM-DD`), worked out
 * from its booked transactions alone: the owner categorises nothing. `balance` is the account's
 * balance on that day.
 */
export function savingsFigures(
  db: Pick<AppDatabase, 'select'>,
  accountId: number,
  day: string,
  balance: number,
): SavingsFigures {
  const rows = db
    .select({ amount: transactions.amount, description: transactions.description })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.status, 'booked'),
        lte(transactions.date, day),
      ),
    )
    .all();
  const sum = rows.reduce(
    (total, row) => (isInterest(row.description) ? total : total + row.amount),
    0,
  );
  const netDeposits = Math.round(sum * 100) / 100;
  return { netDeposits, growth: Math.round((balance - netDeposits) * 100) / 100 };
}
