import { Inject, Injectable } from '@nestjs/common';
import type {
  LoanPartDebt,
  MortgageFiguresResponse,
  MortgageMonth,
  Transaction,
} from '@bankapp/shared';
import { and, asc, eq } from 'drizzle-orm';
import { CLOCK, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import {
  amortisationChanges,
  categories,
  interestRateChanges,
  loanParts,
  mortgageEntries,
  mortgageEntryDebts,
  subcategories,
  transactions,
} from '../db/schema';
import { queryTransactions } from '../transactions/query';
import { addMonths, inForce } from './figures';

const MORTGAGE_CATEGORY = 'Boende & Hushåll';
const MORTGAGE_SUBCATEGORY = 'Bolån ränta & amortering';

const monthOf = (day: string) => day.slice(0, 7);
const nextMonth = (month: string) => monthOf(addMonths(`${month}-01`, 1));
const round = (value: number) => Math.round(value * 100) / 100;

interface Part {
  id: number;
  startedOn: string;
  endedOn: string | null;
  rates: { from: string; value: number }[];
  amortisations: { from: string; value: number }[];
  /** Oldest first. */
  entries: { date: string; debt: number }[];
}

/** The mortgage's remaining debt, estimated monthly payment and what was paid. */
@Injectable()
export class MortgageReport {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  figures(): MortgageFiguresResponse {
    const parts = this.parts();
    const firstEntry = parts.flatMap((p) => p.entries.map((e) => e.date)).sort()[0];
    if (firstEntry === undefined) return { debts: [], months: [], monthsWithoutPayment: [] };

    const today = this.clock.today();
    const payments = this.payments();
    const booked = payments.filter((p) => p.status === 'booked');

    const debts = parts.map((part) => ({
      partId: part.id,
      debt: this.debtOn(part, booked, today, null),
    }));

    const months: MortgageMonth[] = [];
    const monthsWithoutPayment: string[] = [];
    const current = monthOf(today);
    for (let month = monthOf(firstEntry); month <= current; month = nextMonth(month)) {
      months.push(this.month(month, parts, booked, payments));
      if (month < current && !booked.some((p) => monthOf(p.date) === month)) {
        monthsWithoutPayment.push(month);
      }
    }
    return { debts, months, monthsWithoutPayment };
  }

  private month(
    month: string,
    parts: Part[],
    booked: Transaction[],
    payments: Transaction[],
  ): MortgageMonth {
    const first = `${month}-01`;
    const debts: LoanPartDebt[] = [];
    let interest = 0;
    let amortisation = 0;
    for (const part of parts) {
      const open =
        part.startedOn < `${nextMonth(month)}-01` &&
        (part.endedOn === null || part.endedOn > first);
      if (!open) continue;
      const debt = this.debtOn(part, booked, first, first);
      // A part that starts mid-month is estimated from when it began.
      const day = part.startedOn > first ? part.startedOn : first;
      const rate = inForce(part.rates, day) ?? 0;
      debts.push({ partId: part.id, debt });
      interest += (debt * rate) / 100 / 12;
      amortisation += inForce(part.amortisations, day) ?? 0;
    }
    const paid = payments
      .filter((p) => monthOf(p.date) === month)
      .reduce((sum, p) => sum - p.amount.amount, 0);
    interest = round(interest);
    amortisation = round(amortisation);
    return {
      month,
      debts,
      interest,
      amortisation,
      total: round(interest + amortisation),
      paid: round(paid),
    };
  }

  /**
   * A part's remaining debt on `day`: the debt in its latest entry (on or before `cutoff`, when
   * given), less its amortisation for each month after that entry's day with a booked payment
   * (dated before `cutoff`, when given).
   */
  private debtOn(part: Part, booked: Transaction[], day: string, cutoff: string | null): number {
    if (part.endedOn !== null && part.endedOn <= day) return 0;
    const entries = part.entries.filter((e) => cutoff === null || e.date <= cutoff);
    // A part that starts later in the month than `cutoff` has only later entries.
    const entry = entries.at(-1) ?? part.entries[0];
    if (entry === undefined) return 0;
    let debt = entry.debt;
    const paidMonths = new Set<string>();
    for (const payment of booked) {
      if (payment.date <= entry.date || (cutoff !== null && payment.date >= cutoff)) continue;
      if (part.endedOn !== null && payment.date >= part.endedOn) continue;
      const month = monthOf(payment.date);
      if (paidMonths.has(month)) continue;
      paidMonths.add(month);
      debt = Math.max(0, debt - (inForce(part.amortisations, payment.date) ?? 0));
    }
    return round(debt);
  }

  /** Booked and pending payments, oldest first, on accounts that count. */
  private payments(): Transaction[] {
    const subcategory = this.db
      .select({ id: subcategories.id })
      .from(subcategories)
      .innerJoin(categories, eq(subcategories.categoryId, categories.id))
      .where(
        and(eq(categories.name, MORTGAGE_CATEGORY), eq(subcategories.name, MORTGAGE_SUBCATEGORY)),
      )
      .get();
    if (subcategory === undefined) return [];
    return queryTransactions(this.db, {
      where: eq(transactions.subcategoryId, subcategory.id),
    }).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  }

  private parts(): Part[] {
    const rows = this.db.select().from(loanParts).orderBy(asc(loanParts.id)).all();
    const rates = this.db.select().from(interestRateChanges).all();
    const amortisations = this.db.select().from(amortisationChanges).all();
    const entries = this.db
      .select({
        partId: mortgageEntryDebts.partId,
        date: mortgageEntries.date,
        debt: mortgageEntryDebts.debt,
      })
      .from(mortgageEntryDebts)
      .innerJoin(mortgageEntries, eq(mortgageEntries.id, mortgageEntryDebts.entryId))
      .orderBy(asc(mortgageEntries.date))
      .all();
    return rows.map((row) => ({
      id: row.id,
      startedOn: row.startedOn,
      endedOn: row.endedOn,
      rates: rates
        .filter((r) => r.partId === row.id)
        .map((r) => ({ from: r.fromDate, value: r.rate })),
      amortisations: amortisations
        .filter((a) => a.partId === row.id)
        .map((a) => ({ from: a.fromDate, value: a.amount })),
      entries: entries
        .filter((e) => e.partId === row.id)
        .map((e) => ({ date: e.date, debt: e.debt })),
    }));
  }
}
