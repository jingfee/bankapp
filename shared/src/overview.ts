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

/**
 * What went into savings (Överföring › Sparande & investeringar) net: money leaving the owner's
 * accounts counts as a deposit, money coming back lowers it. Always the full amount, whatever the
 * view. It is a transfer, so it is in none of the totals.
 */
export interface OverviewSavings {
  /** The Sparande & investeringar subcategory, to link to its transactions. */
  subcategoryId: number | null;
  current: number;
  /** The same for the month before. */
  previous: number;
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

/**
 * Whose money the overview totals: the owner's share of each transaction (`mine`, Min andel) or
 * its full amount (`full`, Hela beloppet). See ADR 0007.
 */
export const OVERVIEW_VIEWS = ['mine', 'full'] as const;
export type OverviewView = (typeof OVERVIEW_VIEWS)[number];

/**
 * Spending accumulated day by day: entry 0 is day 1 of the month, the last entry the month's
 * `spending` total. One entry per calendar day, also for days still to come.
 */
export interface OverviewSpendingByDay {
  current: number[];
  /** The same for the month before. */
  previous: number[];
}

/** Response body of `GET /api/overview?month=YYYY-MM&view=`; `view` defaults to `full`. */
export interface OverviewResponse {
  month: string;
  totals: OverviewTotals;
  /** The same totals for the month before. */
  previous: OverviewTotals;
  spendingByDay: OverviewSpendingByDay;
  savings: OverviewSavings;
  /** Categories with transactions that month, largest first; income and expense together. */
  categories: OverviewCategory[];
  /** Transactions of the month without a subcategory; they are in no total. */
  uncategorised: number;
}

/** Response body of `GET /api/overview/transactions?month=&subcategoryId=`, newest first. */
export interface OverviewTransactionsResponse {
  transactions: Transaction[];
}
