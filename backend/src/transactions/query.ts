import type {
  AccountType,
  Category,
  CategoryIcon,
  EffectiveShare,
  Transaction,
  TransactionAccount,
  TransactionCategory,
} from '@bankapp/shared';
import { and, eq, exists, inArray, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { effectiveShares, ownerPart } from '../accounts/shares';
import type { AppDatabase } from '../db/database';
import { accounts, categories, connections, subcategories, transactions } from '../db/schema';

const replacers = alias(transactions, 'replacers');

/** The purchase a transaction is offset against, if it is a kvittad refund (ADR 0006); left-joined by `queryTransactions`. */
export const purchases = alias(transactions, 'purchases');

/** True for a manual transaction that a bank transaction replaces (ADR 0009). */
export function isReplaced(db: Pick<AppDatabase, 'select'>) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(replacers)
      .where(eq(replacers.replacesTransactionId, transactions.id)),
  );
}

/**
 * Only transactions of accounts the owner has not hidden are shown anywhere; a manual
 * transaction has no account and is never hidden, unless a bank transaction replaces it
 * (ADR 0009).
 */
export function onVisibleAccount(db: Pick<AppDatabase, 'select'>) {
  return and(
    or(
      isNull(transactions.accountId),
      inArray(
        transactions.accountId,
        db.select({ id: accounts.id }).from(accounts).where(eq(accounts.hidden, false)),
      ),
    ),
    not(isReplaced(db)),
  )!;
}

/** The columns `toCategory` reads; select them with the subcategory and category left-joined. */
const categoryColumns = {
  confirmed: transactions.categoryConfirmed,
  subcategoryId: subcategories.id,
  subcategoryName: subcategories.name,
  subcategoryIcon: subcategories.icon,
  categoryId: categories.id,
  categoryName: categories.name,
  categoryColour: categories.colour,
};

interface CategoryColumns {
  confirmed: boolean;
  subcategoryId: number | null;
  subcategoryName: string | null;
  subcategoryIcon: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryColour: string | null;
}

/** A transaction's category as the API shows it, or null when it is uncategorised. */
function toCategory(row: CategoryColumns): TransactionCategory | null {
  if (row.subcategoryId === null || row.categoryId === null) return null;
  return {
    // Stored as text; only palette and icon names are ever written.
    category: {
      id: row.categoryId,
      name: row.categoryName ?? '',
      colour: row.categoryColour as Category['colour'],
    },
    subcategory: {
      id: row.subcategoryId,
      name: row.subcategoryName ?? '',
      icon: row.subcategoryIcon as CategoryIcon,
    },
    confirmed: row.confirmed,
  };
}

interface ListedRow {
  transaction: typeof transactions.$inferSelect;
  /** Null for a manual transaction, which has no account (the account is left-joined). */
  accountName: string | null;
  accountType: AccountType | null;
  bank: string | null;
  category: CategoryColumns;
}

function toTransaction(
  { transaction: row, accountName, accountType, bank, category }: ListedRow,
  share: EffectiveShare,
): Transaction {
  return {
    id: row.id,
    status: row.status,
    amount: { amount: row.amount, currency: row.currency },
    date: row.date,
    description: row.description,
    account: toAccount(row.accountId, accountName, bank, accountType),
    category: toCategory(category),
    share,
    ownerPart: ownerPart(row.amount, share.percent),
    paidBy: row.paidBy,
  };
}

/** The account as the API shows it, or null for a manual transaction. */
function toAccount(
  id: number | null,
  name: string | null,
  bank: string | null,
  type: AccountType | null,
): TransactionAccount | null {
  return id === null || name === null || bank === null || type === null
    ? null
    : { id, name, bank, type };
}

export interface TransactionQuery {
  /**
   * What the transactions must meet, over `transactions`, `accounts`, `subcategories`,
   * `categories` and `purchases` (all joined). The visibility rule is added to it.
   */
  where?: SQL | undefined;
  orderBy?: SQL[];
  limit?: number;
}

/**
 * The transactions that count and meet `where`, finished: account, category and effective share
 * resolved. Hidden accounts and replaced manual transactions are never returned (`onVisibleAccount`).
 */
export function queryTransactions(
  db: Pick<AppDatabase, 'select'>,
  { where, orderBy = [], limit }: TransactionQuery = {},
): Transaction[] {
  const query = db
    .select({
      transaction: transactions,
      accountName: accounts.name,
      accountType: accounts.type,
      bank: connections.bankName,
      category: categoryColumns,
    })
    .from(transactions)
    .leftJoin(purchases, eq(transactions.offsetsTransactionId, purchases.id))
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(connections, eq(accounts.connectionId, connections.id))
    .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
    .leftJoin(categories, eq(subcategories.categoryId, categories.id))
    .where(and(onVisibleAccount(db), where))
    .orderBy(...orderBy)
    .$dynamic();
  const rows = (limit === undefined ? query : query.limit(limit)).all();
  const shares = effectiveShares(
    db,
    rows.map((row) => row.transaction),
  );
  return rows.map((row) => toTransaction(row, shares.get(row.transaction.id)!));
}

/** The category a transaction has now, whether or not it counts; null when uncategorised. */
export function categoryOf(
  db: Pick<AppDatabase, 'select'>,
  id: number,
): TransactionCategory | null {
  const row = db
    .select(categoryColumns)
    .from(transactions)
    .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
    .leftJoin(categories, eq(subcategories.categoryId, categories.id))
    .where(eq(transactions.id, id))
    .get();
  return row ? toCategory(row) : null;
}
