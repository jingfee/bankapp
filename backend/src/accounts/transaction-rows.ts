import type {
  AccountType,
  Category,
  CategoryIcon,
  EffectiveShare,
  Transaction,
  TransactionAccount,
  TransactionCategory,
} from '@bankapp/shared';
import { and, eq, exists, inArray, isNull, not, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { AppDatabase } from '../db/database';
import { accounts, categories, subcategories, transactions } from '../db/schema';

const replacers = alias(transactions, 'replacers');

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
export function onVisibleAccount(db: AppDatabase) {
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
export const categoryColumns = {
  confirmed: transactions.categoryConfirmed,
  subcategoryId: subcategories.id,
  subcategoryName: subcategories.name,
  subcategoryIcon: subcategories.icon,
  categoryId: categories.id,
  categoryName: categories.name,
  categoryColour: categories.colour,
};

export interface CategoryColumns {
  confirmed: boolean;
  subcategoryId: number | null;
  subcategoryName: string | null;
  subcategoryIcon: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryColour: string | null;
}

/** A transaction's category as the API shows it, or null when it is uncategorised. */
export function toCategory(row: CategoryColumns): TransactionCategory | null {
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

export interface ListedRow {
  transaction: typeof transactions.$inferSelect;
  /** Null for a manual transaction, which has no account (the account is left-joined). */
  accountName: string | null;
  accountType: AccountType | null;
  bank: string | null;
  category: CategoryColumns;
}

export function toTransaction(
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
    paidBy: row.paidBy,
  };
}

/** The account as the API shows it, or null for a manual transaction. */
export function toAccount(
  id: number | null,
  name: string | null,
  bank: string | null,
  type: AccountType | null,
): TransactionAccount | null {
  return id === null || name === null || bank === null || type === null
    ? null
    : { id, name, bank, type };
}
