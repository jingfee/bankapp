import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type {
  CategoryIcon,
  OverviewCategory,
  OverviewResponse,
  OverviewTotals,
  OverviewTransactionsResponse,
} from '@bankapp/shared';
import { categoryColumns, toTransaction } from '../accounts/transaction-rows';
import { CLOCK, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { accounts, categories, connections, subcategories, transactions } from '../db/schema';

/** Whether `value` is a month as `YYYY-MM`. */
export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The month before or after `month` (`YYYY-MM`). */
function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (number - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The purchase a transaction is offset against, if it is a kvittad refund (ADR 0006). */
const purchases = alias(transactions, 'purchases');

/** Money sums are floats; rounding to öre keeps the noise out of the API. */
const round = (value: number) => Math.round(value * 100) / 100 + 0;

@Injectable()
export class OverviewService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /** The current month as `YYYY-MM`, in the server's own time like the frontend's. */
  currentMonth(): string {
    const now = this.now();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Income, spending and net of `month` and the month before, with the breakdown by category.
   * Transfers and uncategorised transactions are in no total; pending ones are, by their date.
   * A kvittad refund counts in its purchase's month.
   */
  overview(month: string): OverviewResponse {
    const current = this.summarise(month);
    return {
      month,
      totals: current.totals,
      previous: this.summarise(shiftMonth(month, -1)).totals,
      categories: current.categories,
      uncategorised: current.uncategorised,
    };
  }

  /** The transactions of one subcategory in `month`, newest first. */
  listForSubcategory(month: string, subcategoryId: number): OverviewTransactionsResponse {
    const rows = this.db
      .select({
        transaction: transactions,
        accountName: accounts.name,
        accountType: accounts.type,
        bank: connections.bankName,
        category: categoryColumns,
      })
      .from(transactions)
      .leftJoin(purchases, eq(transactions.offsetsTransactionId, purchases.id))
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .innerJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
      .innerJoin(categories, eq(subcategories.categoryId, categories.id))
      .where(and(this.inMonth(month), eq(transactions.subcategoryId, subcategoryId)))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .all();
    return { transactions: rows.map(toTransaction) };
  }

  /** In `month` by the transaction's date, or by its purchase's when it is a kvittad refund. */
  private inMonth(month: string) {
    const date = sql<string>`coalesce(${purchases.date}, ${transactions.date})`;
    return and(gte(date, `${month}-01`), lt(date, `${shiftMonth(month, 1)}-01`));
  }

  private summarise(
    month: string,
  ): Pick<OverviewResponse, 'totals' | 'categories' | 'uncategorised'> {
    const rows = this.db
      .select({
        amount: transactions.amount,
        subcategoryId: subcategories.id,
        subcategoryName: subcategories.name,
        subcategoryIcon: subcategories.icon,
        categoryId: categories.id,
        categoryName: categories.name,
        kind: categories.kind,
        colour: categories.colour,
        categoryIcon: categories.icon,
        sortOrder: categories.sortOrder,
      })
      .from(transactions)
      .leftJoin(purchases, eq(transactions.offsetsTransactionId, purchases.id))
      .leftJoin(subcategories, eq(transactions.subcategoryId, subcategories.id))
      .leftJoin(categories, eq(subcategories.categoryId, categories.id))
      .where(this.inMonth(month))
      .all();

    let uncategorised = 0;
    const byCategory = new Map<number, OverviewCategory>();
    for (const row of rows) {
      if (row.subcategoryId === null || row.categoryId === null || row.kind === null) {
        uncategorised += 1;
        continue;
      }
      if (row.kind === 'transfer') continue;
      // Spending is money out, so expenses are negated; income is counted as it is.
      const value = row.kind === 'expense' ? -row.amount : row.amount;
      let category = byCategory.get(row.categoryId);
      if (category === undefined) {
        category = {
          id: row.categoryId,
          name: row.categoryName ?? '',
          kind: row.kind,
          // Stored as text; only migrations write them, with palette and icon names.
          colour: row.colour as OverviewCategory['colour'],
          icon: row.categoryIcon as CategoryIcon,
          total: 0,
          subcategories: [],
        };
        byCategory.set(row.categoryId, category);
      }
      category.total += value;
      let sub = category.subcategories.find((s) => s.id === row.subcategoryId);
      if (sub === undefined) {
        sub = {
          id: row.subcategoryId,
          name: row.subcategoryName ?? '',
          icon: row.subcategoryIcon as CategoryIcon,
          total: 0,
        };
        category.subcategories.push(sub);
      }
      sub.total += value;
    }

    const list = [...byCategory.values()].map((category) => ({
      ...category,
      total: round(category.total),
      subcategories: category.subcategories
        .map((sub) => ({ ...sub, total: round(sub.total) }))
        .sort((a, b) => b.total - a.total),
    }));
    list.sort((a, b) => b.total - a.total);

    const sum = (kind: 'income' | 'expense') =>
      round(list.filter((c) => c.kind === kind).reduce((total, c) => total + c.total, 0));
    const totals: OverviewTotals = {
      income: sum('income'),
      spending: sum('expense'),
      net: 0,
    };
    totals.net = round(totals.income - totals.spending);
    return { totals, categories: list, uncategorised };
  }
}
