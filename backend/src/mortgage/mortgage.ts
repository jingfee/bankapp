import { Inject, Injectable } from '@nestjs/common';
import type {
  LoanPart,
  MortgageEntry,
  MortgageResponse,
  RecurringDay,
  RecurringDayRequest,
} from '@bankapp/shared';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { CLOCK, isDay, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import {
  amortisationChanges,
  interestRateChanges,
  loanParts,
  mortgageEntries,
  mortgageEntryDebts,
} from '../db/schema';
import {
  InvalidInput,
  LoanPartEnded,
  MortgageEntryDateTaken,
  NoSuchLoanPart,
  NoSuchMortgageEntry,
} from '../domain-errors';
import { inForce, nextOccurrence } from './figures';

const MAX_AMOUNT = 1e12;
const MAX_INTERVAL_MONTHS = 120;

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 100) {
    throw new InvalidInput(`${field} must be a text of at most 100 characters`);
  }
  return value.trim();
}

/** A non-negative number rounded to `decimals` places. */
function nonNegative(value: unknown, field: string, max: number, decimals = 2): number {
  const factor = 10 ** decimals;
  const rounded = typeof value === 'number' ? Math.round(value * factor) / factor : NaN;
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > max) {
    throw new InvalidInput(`${field} must be a number of at least 0`);
  }
  return rounded;
}

const kronor = (value: unknown, field: string) => nonNegative(value, field, MAX_AMOUNT);
const rate = (value: unknown) => nonNegative(value, 'rate', 100, 4);

function recurring(value: unknown, field: string): RecurringDayRequest {
  const { next, intervalMonths } = (value ?? {}) as Record<string, unknown>;
  if (typeof next !== 'string' || !isDay(next)) {
    throw new InvalidInput(`${field}.next must be a day, YYYY-MM-DD`);
  }
  if (
    typeof intervalMonths !== 'number' ||
    !Number.isInteger(intervalMonths) ||
    intervalMonths < 1 ||
    intervalMonths > MAX_INTERVAL_MONTHS
  ) {
    throw new InvalidInput(`${field}.intervalMonths must be a whole number of months, at least 1`);
  }
  return { next, intervalMonths };
}

/** The owner's mortgage: its loan parts, their dated rates and amortisation, and mortgage entries. */
@Injectable()
export class Mortgage {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  get(): MortgageResponse {
    const today = this.clock.today();
    const rows = this.db.select().from(loanParts).orderBy(asc(loanParts.id)).all();
    const latestDebts = this.latestDebts();
    const parts = rows.map((row) => this.part(row, latestDebts.get(row.id) ?? null, today));
    // Open parts first; each group keeps the order they were added in.
    parts.sort((a, b) => Number(a.endedOn !== null) - Number(b.endedOn !== null) || a.id - b.id);
    return { parts, entries: this.entries() };
  }

  /** Adds a part from a day, with its first debt, rate and amortisation. */
  addPart(input: unknown): MortgageResponse {
    const body = (input ?? {}) as Record<string, unknown>;
    const name = text(body.name, 'name');
    const startedOn = this.day(body.startedOn, 'startedOn', { future: false });
    const debt = kronor(body.debt, 'debt');
    const initialRate = rate(body.rate);
    const amortisation = kronor(body.amortisation, 'amortisation');
    const rateAdjustment = recurring(body.rateAdjustment, 'rateAdjustment');
    const termsChange = recurring(body.termsChange, 'termsChange');

    this.db.transaction((tx) => {
      const { id } = tx
        .insert(loanParts)
        .values({
          name,
          startedOn,
          rateAdjustmentDate: rateAdjustment.next,
          rateAdjustmentIntervalMonths: rateAdjustment.intervalMonths,
          termsChangeDate: termsChange.next,
          termsChangeIntervalMonths: termsChange.intervalMonths,
        })
        .returning({ id: loanParts.id })
        .get();
      tx.insert(interestRateChanges)
        .values({ partId: id, fromDate: startedOn, rate: initialRate })
        .run();
      tx.insert(amortisationChanges)
        .values({ partId: id, fromDate: startedOn, amount: amortisation })
        .run();
      // The first debt joins the start day's entry, which another part may already have made.
      const entry = tx
        .insert(mortgageEntries)
        .values({ date: startedOn })
        .onConflictDoUpdate({ target: mortgageEntries.date, set: { date: startedOn } })
        .returning({ id: mortgageEntries.id })
        .get();
      tx.insert(mortgageEntryDebts).values({ entryId: entry.id, partId: id, debt }).run();
    });
    return this.get();
  }

  /** Renames a part and/or moves its recurring days; what is left out is unchanged. */
  updatePart(id: number, input: unknown): MortgageResponse {
    this.require(id);
    const body = (input ?? {}) as Record<string, unknown>;
    const set: Partial<typeof loanParts.$inferInsert> = {};
    if (body.name !== undefined) set.name = text(body.name, 'name');
    if (body.rateAdjustment !== undefined) {
      const { next, intervalMonths } = recurring(body.rateAdjustment, 'rateAdjustment');
      set.rateAdjustmentDate = next;
      set.rateAdjustmentIntervalMonths = intervalMonths;
    }
    if (body.termsChange !== undefined) {
      const { next, intervalMonths } = recurring(body.termsChange, 'termsChange');
      set.termsChangeDate = next;
      set.termsChangeIntervalMonths = intervalMonths;
    }
    if (Object.keys(set).length > 0) {
      this.db.update(loanParts).set(set).where(eq(loanParts.id, id)).run();
    }
    return this.get();
  }

  /** Ends a part on a day (today by default): it counts as 0 from then on. */
  endPart(id: number, input: unknown): MortgageResponse {
    const part = this.require(id);
    if (part.endedOn !== null) throw new LoanPartEnded();
    const { date } = (input ?? {}) as Record<string, unknown>;
    const endedOn = this.day(date, 'date', { future: false });
    if (endedOn < part.startedOn) throw new InvalidInput('date cannot be before the part started');
    this.db.transaction((tx) => {
      tx.update(loanParts).set({ endedOn }).where(eq(loanParts.id, id)).run();
      // The part counts as 0 from that day, so entries from then on no longer hold its debt.
      const later = tx
        .select({ id: mortgageEntries.id })
        .from(mortgageEntries)
        .where(gte(mortgageEntries.date, endedOn))
        .all()
        .map((entry) => entry.id);
      if (later.length === 0) return;
      tx.delete(mortgageEntryDebts)
        .where(and(eq(mortgageEntryDebts.partId, id), inArray(mortgageEntryDebts.entryId, later)))
        .run();
      for (const entryId of later) {
        const left = tx
          .select({ partId: mortgageEntryDebts.partId })
          .from(mortgageEntryDebts)
          .where(eq(mortgageEntryDebts.entryId, entryId))
          .get();
        if (left === undefined)
          tx.delete(mortgageEntries).where(eq(mortgageEntries.id, entryId)).run();
      }
    });
    return this.get();
  }

  /** Records a rate from a day; one for a day that already has one replaces it. */
  addRateChange(partId: number, input: unknown): MortgageResponse {
    this.requireOpen(partId);
    const body = (input ?? {}) as Record<string, unknown>;
    const fromDate = this.day(body.from, 'from', { future: true });
    const value = rate(body.rate);
    this.db
      .insert(interestRateChanges)
      .values({ partId, fromDate, rate: value })
      .onConflictDoUpdate({
        target: [interestRateChanges.partId, interestRateChanges.fromDate],
        set: { rate: value },
      })
      .run();
    return this.get();
  }

  /** Records an amortisation from a day; one for a day that already has one replaces it. */
  addAmortisationChange(partId: number, input: unknown): MortgageResponse {
    this.requireOpen(partId);
    const body = (input ?? {}) as Record<string, unknown>;
    const fromDate = this.day(body.from, 'from', { future: true });
    const amount = kronor(body.amount, 'amount');
    this.db
      .insert(amortisationChanges)
      .values({ partId, fromDate, amount })
      .onConflictDoUpdate({
        target: [amortisationChanges.partId, amortisationChanges.fromDate],
        set: { amount },
      })
      .run();
    return this.get();
  }

  /** Adds an entry; one for a day that already has one replaces it. */
  addEntry(input: unknown): MortgageResponse {
    const { date, debts } = this.parseEntry(input);
    this.db.transaction((tx) => {
      const entry = tx
        .insert(mortgageEntries)
        .values({ date })
        .onConflictDoUpdate({ target: mortgageEntries.date, set: { date } })
        .returning({ id: mortgageEntries.id })
        .get();
      this.writeDebts(tx, entry.id, debts);
    });
    return this.get();
  }

  /** Corrects an entry; moving it onto another entry's day is refused. */
  updateEntry(entryId: number, input: unknown): MortgageResponse {
    const current = this.entry(entryId);
    const { date, debts } = this.parseEntry(input, current.date);
    const taken = this.db
      .select({ id: mortgageEntries.id })
      .from(mortgageEntries)
      .where(eq(mortgageEntries.date, date))
      .get();
    if (taken !== undefined && taken.id !== entryId) throw new MortgageEntryDateTaken();
    this.db.transaction((tx) => {
      tx.update(mortgageEntries).set({ date }).where(eq(mortgageEntries.id, entryId)).run();
      this.writeDebts(tx, entryId, debts);
    });
    return this.get();
  }

  deleteEntry(entryId: number): MortgageResponse {
    this.entry(entryId);
    this.db.transaction((tx) => {
      tx.delete(mortgageEntryDebts).where(eq(mortgageEntryDebts.entryId, entryId)).run();
      tx.delete(mortgageEntries).where(eq(mortgageEntries.id, entryId)).run();
    });
    return this.get();
  }

  private parseEntry(input: unknown, fallbackDate?: string) {
    const body = (input ?? {}) as Record<string, unknown>;
    const date = this.day(body.date, 'date', { future: false, fallback: fallbackDate });
    if (!Array.isArray(body.debts)) throw new InvalidInput('debts must be a list');
    const debts = new Map<number, number>();
    for (const item of body.debts as unknown[]) {
      const { partId, debt } = (item ?? {}) as Record<string, unknown>;
      if (typeof partId !== 'number' || !Number.isInteger(partId) || debts.has(partId)) {
        throw new InvalidInput('debts must name each loan part once');
      }
      debts.set(partId, kronor(debt, 'debt'));
    }
    // An entry states the debt of every part open on the day, and of no other.
    const open = this.db
      .select()
      .from(loanParts)
      .all()
      .filter((part) => part.startedOn <= date && (part.endedOn === null || date < part.endedOn))
      .map((part) => part.id);
    if (open.length === 0) throw new InvalidInput('no loan part is open on that day');
    if (open.length !== debts.size || open.some((id) => !debts.has(id))) {
      throw new InvalidInput('debts must hold the debt of every loan part open on that day');
    }
    return { date, debts };
  }

  private writeDebts(
    tx: Pick<AppDatabase, 'delete' | 'insert'>,
    entryId: number,
    debts: Map<number, number>,
  ): void {
    tx.delete(mortgageEntryDebts).where(eq(mortgageEntryDebts.entryId, entryId)).run();
    tx.insert(mortgageEntryDebts)
      .values([...debts].map(([partId, debt]) => ({ entryId, partId, debt })))
      .run();
  }

  private entries(): MortgageEntry[] {
    const rows = this.db.select().from(mortgageEntries).orderBy(desc(mortgageEntries.date)).all();
    if (rows.length === 0) return [];
    const debts = this.db
      .select()
      .from(mortgageEntryDebts)
      .where(
        inArray(
          mortgageEntryDebts.entryId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(mortgageEntryDebts.partId))
      .all();
    return rows.map((row) => ({
      id: row.id,
      date: row.date,
      debts: debts
        .filter((debt) => debt.entryId === row.id)
        .map(({ partId, debt }) => ({ partId, debt })),
    }));
  }

  /** Each part's debt in its latest entry. */
  private latestDebts(): Map<number, number> {
    const latest = new Map<number, number>();
    const rows = this.db
      .select({
        partId: mortgageEntryDebts.partId,
        debt: mortgageEntryDebts.debt,
      })
      .from(mortgageEntryDebts)
      .innerJoin(mortgageEntries, eq(mortgageEntries.id, mortgageEntryDebts.entryId))
      .orderBy(asc(mortgageEntries.date))
      .all();
    for (const row of rows) latest.set(row.partId, row.debt);
    return latest;
  }

  private part(row: typeof loanParts.$inferSelect, debt: number | null, today: string): LoanPart {
    const rateChanges = this.db
      .select({
        id: interestRateChanges.id,
        from: interestRateChanges.fromDate,
        rate: interestRateChanges.rate,
      })
      .from(interestRateChanges)
      .where(eq(interestRateChanges.partId, row.id))
      .orderBy(desc(interestRateChanges.fromDate))
      .all();
    const amortisation = this.db
      .select({
        id: amortisationChanges.id,
        from: amortisationChanges.fromDate,
        amount: amortisationChanges.amount,
      })
      .from(amortisationChanges)
      .where(eq(amortisationChanges.partId, row.id))
      .orderBy(desc(amortisationChanges.fromDate))
      .all();
    const ended = row.endedOn !== null && row.endedOn <= today;
    const day = (date: string, intervalMonths: number): RecurringDay => ({
      next: nextOccurrence(date, intervalMonths, today),
      intervalMonths,
    });
    return {
      id: row.id,
      name: row.name,
      startedOn: row.startedOn,
      endedOn: row.endedOn,
      debt: ended ? 0 : debt,
      rate: ended
        ? 0
        : inForce(
            rateChanges.map((c) => ({ from: c.from, value: c.rate })),
            today,
          ),
      amortisation: ended
        ? 0
        : inForce(
            amortisation.map((c) => ({ from: c.from, value: c.amount })),
            today,
          ),
      rateChanges,
      amortisationChanges: amortisation,
      rateAdjustment: day(row.rateAdjustmentDate, row.rateAdjustmentIntervalMonths),
      termsChange: day(row.termsChangeDate, row.termsChangeIntervalMonths),
    };
  }

  /** A day from the request; today unless a fallback is given. */
  private day(
    value: unknown,
    field: string,
    options: { future: boolean; fallback?: string },
  ): string {
    if (value === undefined || value === null) return options.fallback ?? this.clock.today();
    if (typeof value !== 'string' || !isDay(value)) {
      throw new InvalidInput(`${field} must be a day, YYYY-MM-DD`);
    }
    if (!options.future && value > this.clock.today()) {
      throw new InvalidInput(`${field} cannot be in the future`);
    }
    return value;
  }

  private require(id: number) {
    const row = this.db.select().from(loanParts).where(eq(loanParts.id, id)).get();
    if (row === undefined) throw new NoSuchLoanPart();
    return row;
  }

  private requireOpen(id: number) {
    const row = this.require(id);
    if (row.endedOn !== null) throw new LoanPartEnded();
    return row;
  }

  private entry(id: number) {
    const row = this.db.select().from(mortgageEntries).where(eq(mortgageEntries.id, id)).get();
    if (row === undefined) throw new NoSuchMortgageEntry();
    return row;
  }
}
