import type { Transaction } from './accounts';
import type { CategoryIcon } from './category-icons';
import type { CategoryColour } from './category-palette';

/** Income, spending and net of one month; transfers are in none of them. */
export interface OverviewTotals {
  income: number;
  /** Money out of expense categories, refunds reducing it. */
  spending: number;
  /** `income - spending`. */
  net: number;
}

export interface OverviewSubcategory {
  id: number;
  name: string;
  icon: CategoryIcon;
  /** Spent (positive) for an expense category, received for the income category. */
  total: number;
}

/** An expense or the income category with what the month holds in it. */
export interface OverviewCategory {
  id: number;
  name: string;
  kind: 'expense' | 'income';
  colour: CategoryColour;
  icon: CategoryIcon;
  total: number;
  /** Only subcategories with transactions that month, largest first. */
  subcategories: OverviewSubcategory[];
}

/** Response body of `GET /api/overview?month=YYYY-MM`. */
export interface OverviewResponse {
  month: string;
  totals: OverviewTotals;
  /** The same totals for the month before. */
  previous: OverviewTotals;
  /** Categories with transactions that month, largest first; income and expense together. */
  categories: OverviewCategory[];
  /** Transactions of the month without a subcategory; they are in no total. */
  uncategorised: number;
}

/** Response body of `GET /api/overview/transactions?month=&subcategoryId=`, newest first. */
export interface OverviewTransactionsResponse {
  transactions: Transaction[];
}
