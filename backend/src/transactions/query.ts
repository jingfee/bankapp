import type {
  AccountType,
  Category,
  CategoryIcon,
  CategoryKind,
  EffectiveShare,
  Transaction,
  TransactionAccount,
  TransactionCategory,
} from '@bankapp/shared';
import {
  and,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { effectiveShares, ownerPart } from './shares';
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
 * Only transactions of accounts the owner has neither hidden nor marked as a savings account
 * (followed by balance only) are shown anywhere; a manual
 * transaction has no account and is never hidden, unless a bank transaction replaces it
 * (ADR 0009).
 */
export function onVisibleAccount(db: Pick<AppDatabase, 'select'>) {
  return and(
    or(
      isNull(transactions.accountId),
      inArray(
        transactions.accountId,
        db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.hidden, false), eq(accounts.savings, false))),
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

/**
 * A counted transaction with what the readers of the ledger fold over, and the API does not
 * send: the category's kind, icon and order, and the date of the purchase a kvittad refund offsets.
 */
export type LedgerRow = Transaction & {
  /** Null when uncategorised. */
  kind: CategoryKind | null;
  /** The purchase's date when this is a kvittad refund (ADR 0006), else null. */
  purchaseDate: string | null;
  categoryIcon: CategoryIcon | null;
  categorySortOrder: number | null;
};

/** The transaction as the API shows it: the ledger fields dropped. */
export function toListed(row: LedgerRow): Transaction {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { kind, purchaseDate, categoryIcon, categorySortOrder, ...transaction } = row;
  return transaction;
}

interface JoinedRow {
  transaction: typeof transactions.$inferSelect;
  /** Null for a manual transaction, which has no account (the account is left-joined). */
  accountName: string | null;
  accountType: AccountType | null;
  bank: string | null;
  category: CategoryColumns;
  kind: CategoryKind | null;
  purchaseDate: string | null;
  categoryIcon: string | null;
  categorySortOrder: number | null;
}

function toLedgerRow(
  {
    transaction: row,
    accountName,
    accountType,
    bank,
    category,
    kind,
    purchaseDate,
    categoryIcon,
    categorySortOrder,
  }: JoinedRow,
  share: EffectiveShare,
): LedgerRow {
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
    kind,
    purchaseDate,
    // Stored as text; only migrations write them, with icon names.
    categoryIcon: categoryIcon as CategoryIcon | null,
    categorySortOrder,
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

/** Which transactions count; the visibility rule (`onVisibleAccount`) always applies on top. */
export interface LedgerFilter {
  /**
   * What the transactions must meet, over `transactions`, `accounts`, `subcategories`,
   * `categories` and `purchases` (all joined).
   */
  where?: SQL | undefined;
  /**
   * Which date `from` and `before` apply to. `'own-date'` (default) is the transaction's own;
   * `'purchase-month'` is its purchase's when it is a kvittad refund, so the refund counts in
   * its purchase's month (ADR 0006).
   */
  countIn?: 'own-date' | 'purchase-month';
  /** First day that counts (`YYYY-MM-DD`), inclusive. */
  from?: string;
  /** First day that no longer counts, exclusive. */
  before?: string;
  /**
   * Leaves out the days before an account was first connected, unless the transaction replaces a
   * manual one: it stands in for that and so counts even when dated earlier (ADR 0008, 0009).
   */
  sinceConnected?: boolean;
}

export interface TransactionQuery extends LedgerFilter {
  orderBy?: SQL[];
  limit?: number;
}

function counting({
  where,
  countIn = 'own-date',
  from,
  before,
  sinceConnected = false,
}: LedgerFilter): (SQL | undefined)[] {
  const date: SQL =
    countIn === 'purchase-month'
      ? sql`coalesce(${purchases.date}, ${transactions.date})`
      : sql`${transactions.date}`;
  return [
    where,
    from === undefined ? undefined : gte(date, from),
    before === undefined ? undefined : lt(date, before),
    sinceConnected
      ? or(
          isNull(accounts.connectedOn),
          gte(transactions.date, accounts.connectedOn),
          isNotNull(transactions.replacesTransactionId),
        )
      : undefined,
  ];
}

/**
 * The transactions that count and meet the filter, finished: account, category and effective
 * share resolved. Hidden accounts and replaced manual transactions are never returned
 * (`onVisibleAccount`).
 */
export function queryTransactions(
  db: Pick<AppDatabase, 'select'>,
  { orderBy = [], limit, ...filter }: TransactionQuery = {},
): LedgerRow[] {
  const query = db
    .select({
      transaction: transactions,
      accountName: accounts.name,
      accountType: accounts.type,
      bank: connections.bankName,
      category: categoryColumns,
      kind: categories.kind,
      purchaseDate: purchases.date,
      categoryIcon: categories.icon,
      categorySortOrder: categories.sortOrder,
    })
    .from(transactions)
    .leftJoin(purchases, eq(transactions.offsetsTransactionId, purchases.id))
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(connections, eq(accounts.connectionId, connections.id))
    .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
    .leftJoin(categories, eq(subcategories.categoryId, categories.id))
    .where(and(onVisibleAccount(db), ...counting(filter)))
    .orderBy(...orderBy)
    .$dynamic();
  const rows = (limit === undefined ? query : query.limit(limit)).all();
  const shares = effectiveShares(
    db,
    rows.map((row) => row.transaction),
  );
  return rows.map((row) => toLedgerRow(row, shares.get(row.transaction.id)!));
}

/** How many transactions count and meet the filter, and what they add up to. */
export interface TransactionTotals {
  count: number;
  sum: number;
  /** How many distinct currencies the sum adds up; it is only meaningful when this is 1. */
  currencies: number;
  /** The currency when there is one, else any of them. */
  currency: string | null;
}

/** Count and sum of `queryTransactions` with the same filter, joins and visibility, without loading rows. */
export function summariseTransactions(
  db: Pick<AppDatabase, 'select'>,
  filter: LedgerFilter = {},
): TransactionTotals {
  return db
    .select({
      count: sql<number>`count(*)`,
      sum: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
      currencies: sql<number>`count(distinct ${transactions.currency})`,
      currency: sql<string | null>`min(${transactions.currency})`,
    })
    .from(transactions)
    .leftJoin(purchases, eq(transactions.offsetsTransactionId, purchases.id))
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
    .leftJoin(categories, eq(subcategories.categoryId, categories.id))
    .where(and(onVisibleAccount(db), ...counting(filter)))
    .get()!;
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

/** One transaction as listed, or null when there is none or it does not count. */
export function listedTransaction(db: Pick<AppDatabase, 'select'>, id: number): Transaction | null {
  const [row] = queryTransactions(db, { where: eq(transactions.id, id), limit: 1 });
  return row === undefined ? null : toListed(row);
}
