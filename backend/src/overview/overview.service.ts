import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type {
  OverviewCategory,
  OverviewResponse,
  OverviewTotals,
  OverviewTransactionsResponse,
  OverviewView,
} from '@bankapp/shared';
import { daysInMonth, shiftMonth } from '../calendar';
import { CLOCK, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { categories, subcategories, transactions } from '../db/schema';
import { roundOre } from '../transactions/owners-part';
import { queryTransactions, toListed } from '../transactions/query';
import { WELL_KNOWN_SUBCATEGORIES } from '../well-known-subcategories';

/** The ledger filter for `month`: a kvittad refund counts in its purchase's month, else a transaction in its own. */
function countedIn(month: string) {
  return {
    countIn: 'purchase-month',
    from: `${month}-01`,
    before: `${shiftMonth(month, 1)}-01`,
  } as const;
}

/** The transfer subcategory whose net deposits the overview shows as Sparande. */
const SAVINGS_SUBCATEGORY = WELL_KNOWN_SUBCATEGORIES.savings.name;

@Injectable()
export class OverviewService {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The current month as `YYYY-MM`, in the owner's timezone. */
  currentMonth(): string {
    return this.clock.today().slice(0, 7);
  }

  /**
   * Income, spending and net of `month` and the month before, with the breakdown by category.
   * Transfers and uncategorised transactions are in no total; pending ones are, by their date.
   * A kvittad refund counts in its purchase's month. In `mine` every amount is weighted by its
   * effective share, a refund's being its purchase's (ADR 0007); in `full` amounts are as stored.
   */
  overview(month: string, view: OverviewView = 'full'): OverviewResponse {
    const current = this.summarise(month, view);
    const previous = this.summarise(shiftMonth(month, -1), view);
    return {
      month,
      totals: current.totals,
      previous: previous.totals,
      spendingByDay: { current: current.spendingByDay, previous: previous.spendingByDay },
      savings: {
        subcategoryId: this.savingsSubcategoryId(),
        current: current.savings,
        previous: previous.savings,
      },
      categories: current.categories,
      uncategorised: current.uncategorised,
    };
  }

  private savingsSubcategoryId(): number | null {
    return (
      this.db
        .select({ id: subcategories.id })
        .from(subcategories)
        .innerJoin(categories, eq(subcategories.categoryId, categories.id))
        .where(and(eq(categories.kind, 'transfer'), eq(subcategories.name, SAVINGS_SUBCATEGORY)))
        .get()?.id ?? null
    );
  }

  /** The transactions of one subcategory in `month`, newest first. */
  listForSubcategory(month: string, subcategoryId: number): OverviewTransactionsResponse {
    return {
      transactions: queryTransactions(this.db, {
        ...countedIn(month),
        where: eq(transactions.subcategoryId, subcategoryId),
        orderBy: [desc(transactions.date), desc(transactions.id)],
      }).map(toListed),
    };
  }

  /** Every categorised transaction in `month`, newest first: each subcategory's drill-down at once. */
  listForMonth(month: string): OverviewTransactionsResponse {
    return {
      transactions: queryTransactions(this.db, {
        ...countedIn(month),
        where: isNotNull(transactions.subcategoryId),
        orderBy: [desc(transactions.date), desc(transactions.id)],
      }).map(toListed),
    };
  }

  private summarise(
    month: string,
    view: OverviewView,
  ): Pick<OverviewResponse, 'totals' | 'categories' | 'uncategorised'> & {
    spendingByDay: number[];
    savings: number;
  } {
    const rows = queryTransactions(this.db, countedIn(month));

    const daily: number[] = Array(daysInMonth(month)).fill(0);
    let uncategorised = 0;
    let deposited = 0;
    const byCategory = new Map<number, OverviewCategory>();
    for (const row of rows) {
      if (row.category === null || row.kind === null) {
        uncategorised += 1;
        continue;
      }
      if (row.kind === 'transfer') {
        // Savings accounts aren't connected, so only the outgoing leg shows: out is a deposit.
        if (row.category.subcategory.name === SAVINGS_SUBCATEGORY) deposited -= row.amount.amount;
        continue;
      }
      // Spending is money out, so expenses are negated; income is counted as it is.
      const amount = view === 'mine' ? row.ownerPart : row.amount.amount;
      const value = row.kind === 'expense' ? -amount : amount;
      if (row.kind === 'expense') {
        const day = Number((row.purchaseDate ?? row.date).slice(8, 10));
        daily[day - 1]! += value;
      }
      let category = byCategory.get(row.category.category.id);
      if (category === undefined) {
        category = {
          id: row.category.category.id,
          name: row.category.category.name,
          kind: row.kind,
          colour: row.category.category.colour,
          icon: row.categoryIcon!,
          total: 0,
          subcategories: [],
        };
        byCategory.set(row.category.category.id, category);
      }
      category.total += value;
      let sub = category.subcategories.find((s) => s.id === row.category!.subcategory.id);
      if (sub === undefined) {
        sub = {
          id: row.category.subcategory.id,
          name: row.category.subcategory.name,
          icon: row.category.subcategory.icon,
          total: 0,
        };
        category.subcategories.push(sub);
      }
      sub.total += value;
    }

    const list = [...byCategory.values()].map((category) => ({
      ...category,
      total: roundOre(category.total),
      subcategories: category.subcategories
        .map((sub) => ({ ...sub, total: roundOre(sub.total) }))
        .sort((a, b) => b.total - a.total),
    }));
    list.sort((a, b) => b.total - a.total);

    const sum = (kind: 'income' | 'expense') =>
      roundOre(list.filter((c) => c.kind === kind).reduce((total, c) => total + c.total, 0));
    const totals: OverviewTotals = {
      income: sum('income'),
      spending: sum('expense'),
      net: 0,
    };
    totals.net = roundOre(totals.income - totals.spending);
    let running = 0;
    const spendingByDay = daily.map((value) => roundOre((running += value)));
    return { totals, categories: list, uncategorised, spendingByDay, savings: roundOre(deposited) };
  }
}
