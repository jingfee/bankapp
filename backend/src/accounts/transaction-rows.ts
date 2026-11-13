import type {
  AccountType,
  Category,
  CategoryIcon,
  EffectiveShare,
  Transaction,
  TransactionCategory,
} from '@bankapp/shared';
import { eq, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../db/database';
import { accounts, categories, subcategories, transactions } from '../db/schema';

/** Only transactions of accounts the owner has not hidden are shown anywhere. */
export function onVisibleAccount(db: AppDatabase) {
  return inArray(
    transactions.accountId,
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.hidden, false)),
  );
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
  accountName: string;
  accountType: AccountType;
  bank: string;
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
    account: { id: row.accountId, name: accountName, bank, type: accountType },
    category: toCategory(category),
    share,
  };
}
