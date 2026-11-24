import { Inject, Injectable } from '@nestjs/common';
import type {
  BalanceEntryRequest,
  ManualSavingsAccount,
  ManualSavingsAccountRequest,
  ManualSavingsResponse,
} from '@bankapp/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { isDay } from '../calendar';
import { CLOCK, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { balanceEntries, manualSavingsAccounts } from '../db/schema';
import {
  AccountClosed,
  EntryDateTaken,
  InvalidInput,
  NoSuchBalanceEntry,
  NoSuchManualSavingsAccount,
} from '../domain-errors';
import { change, stateOn, type Change, type State } from './figures';

const MAX_AMOUNT = 1e12;

function parseName(input: unknown): ManualSavingsAccountRequest {
  const { name, institution } = (input ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '' || name.length > 100) {
    throw new InvalidInput('name must be a text of at most 100 characters');
  }
  if (institution != null && (typeof institution !== 'string' || institution.length > 100)) {
    throw new InvalidInput('institution must be a text of at most 100 characters');
  }
  const trimmed = typeof institution === 'string' ? institution.trim() : '';
  return { name: name.trim(), institution: trimmed === '' ? null : trimmed };
}

function amount(value: unknown, field: string): number {
  const rounded = typeof value === 'number' ? Math.round(value * 100) / 100 : NaN;
  if (!Number.isFinite(rounded) || Math.abs(rounded) > MAX_AMOUNT) {
    throw new InvalidInput(`${field} must be a number`);
  }
  return rounded;
}

/** Manual savings accounts, such as an ISK, and the balance entries that keep them up to date. */
@Injectable()
export class ManualSavings {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  list(): ManualSavingsResponse {
    const ids = this.db
      .select({ id: manualSavingsAccounts.id })
      .from(manualSavingsAccounts)
      .orderBy(asc(manualSavingsAccounts.id))
      .all();
    return { accounts: ids.map(({ id }) => this.account(id)) };
  }

  create(input: unknown): ManualSavingsAccount {
    const { name, institution } = parseName(input);
    const id = this.db
      .insert(manualSavingsAccounts)
      .values({ name, institution })
      .returning({ id: manualSavingsAccounts.id })
      .get().id;
    return this.account(id);
  }

  rename(id: number, input: unknown): ManualSavingsAccount {
    this.require(id);
    const { name, institution } = parseName(input);
    this.db
      .update(manualSavingsAccounts)
      .set({ name, institution })
      .where(eq(manualSavingsAccounts.id, id))
      .run();
    return this.account(id);
  }

  /** Closes the account on a day (today by default): it counts as 0 from then on. */
  close(id: number, input: unknown): ManualSavingsAccount {
    this.require(id);
    const { date } = (input ?? {}) as Record<string, unknown>;
    const closedOn = this.day(date, 'date');
    const latest = this.db
      .select({ date: balanceEntries.date })
      .from(balanceEntries)
      .where(eq(balanceEntries.accountId, id))
      .orderBy(desc(balanceEntries.date))
      .get();
    if (latest !== undefined && closedOn < latest.date) {
      throw new InvalidInput('date cannot be before the latest balance entry');
    }
    this.db
      .update(manualSavingsAccounts)
      .set({ closedOn })
      .where(eq(manualSavingsAccounts.id, id))
      .run();
    return this.account(id);
  }

  reopen(id: number): ManualSavingsAccount {
    this.require(id);
    this.db
      .update(manualSavingsAccounts)
      .set({ closedOn: null })
      .where(eq(manualSavingsAccounts.id, id))
      .run();
    return this.account(id);
  }

  /** Adds an entry; one for a day that already has one replaces it. */
  addEntry(accountId: number, input: unknown): ManualSavingsAccount {
    const account = this.require(accountId);
    if (account.closedOn !== null) throw new AccountClosed();
    const { date, balance, netDeposits } = this.parseEntry(input);
    this.db
      .insert(balanceEntries)
      .values({ accountId, date, balance, netDeposits })
      .onConflictDoUpdate({
        target: [balanceEntries.accountId, balanceEntries.date],
        set: { balance, netDeposits },
      })
      .run();
    return this.account(accountId);
  }

  /** Corrects an entry; moving it onto another entry's day is refused. */
  updateEntry(accountId: number, entryId: number, input: unknown): ManualSavingsAccount {
    this.require(accountId);
    const current = this.entry(accountId, entryId);
    const { date, balance, netDeposits } = this.parseEntry(input, current.date);
    const taken = this.db
      .select({ id: balanceEntries.id })
      .from(balanceEntries)
      .where(and(eq(balanceEntries.accountId, accountId), eq(balanceEntries.date, date)))
      .get();
    if (taken !== undefined && taken.id !== entryId) throw new EntryDateTaken();
    this.db
      .update(balanceEntries)
      .set({ date, balance, netDeposits })
      .where(eq(balanceEntries.id, entryId))
      .run();
    return this.account(accountId);
  }

  deleteEntry(accountId: number, entryId: number): ManualSavingsAccount {
    this.require(accountId);
    this.entry(accountId, entryId);
    this.db.delete(balanceEntries).where(eq(balanceEntries.id, entryId)).run();
    return this.account(accountId);
  }

  /**
   * Each account's balance and net deposits on a day, carried forward from its latest entry on
   * or before it. Accounts with no entry yet are left out. For the Sparande page.
   */
  figuresOn(day: string): { accountId: number; state: State }[] {
    return this.list().accounts.flatMap((account) => {
      const state = stateOn(account.entries, account.closedOn, day);
      return state === null ? [] : [{ accountId: account.id, state }];
    });
  }

  /** Each account's deposits and growth in the stretch after `from` up to and including `to`. */
  changeBetween(from: string, to: string): { accountId: number; change: Change | null }[] {
    return this.list().accounts.map((account) => ({
      accountId: account.id,
      change: change(account.entries, account.closedOn, from, to),
    }));
  }

  private parseEntry(input: unknown, fallbackDate?: string) {
    const { date, balance, netDeposits } = (input ?? {}) as Record<string, unknown>;
    return {
      date: this.day(date, 'date', fallbackDate),
      balance: amount(balance, 'balance'),
      netDeposits: netDeposits == null ? null : amount(netDeposits, 'netDeposits'),
    } satisfies Required<BalanceEntryRequest>;
  }

  /** A day from the request, never in the future; today unless a fallback is given. */
  private day(value: unknown, field: string, fallback?: string): string {
    if (value === undefined || value === null) return fallback ?? this.clock.today();
    if (typeof value !== 'string' || !isDay(value)) {
      throw new InvalidInput(`${field} must be a day, YYYY-MM-DD`);
    }
    if (value > this.clock.today()) throw new InvalidInput(`${field} cannot be in the future`);
    return value;
  }

  private require(id: number) {
    const row = this.db
      .select()
      .from(manualSavingsAccounts)
      .where(eq(manualSavingsAccounts.id, id))
      .get();
    if (row === undefined) throw new NoSuchManualSavingsAccount();
    return row;
  }

  private entry(accountId: number, entryId: number) {
    const row = this.db
      .select()
      .from(balanceEntries)
      .where(and(eq(balanceEntries.id, entryId), eq(balanceEntries.accountId, accountId)))
      .get();
    if (row === undefined) throw new NoSuchBalanceEntry();
    return row;
  }

  private account(id: number): ManualSavingsAccount {
    const row = this.require(id);
    const entries = this.db
      .select({
        id: balanceEntries.id,
        date: balanceEntries.date,
        balance: balanceEntries.balance,
        netDeposits: balanceEntries.netDeposits,
      })
      .from(balanceEntries)
      .where(eq(balanceEntries.accountId, id))
      .orderBy(desc(balanceEntries.date))
      .all();
    const today = this.clock.today();
    const state = stateOn(entries, row.closedOn, today);
    // Growth since opening is the balance less net deposits, so it is read off the state.
    const growth =
      state === null || state.netDeposits === null || state.closed
        ? null
        : state.balance - state.netDeposits;
    return {
      id: row.id,
      name: row.name,
      institution: row.institution,
      closedOn: row.closedOn,
      entries,
      balance: state?.balance ?? null,
      netDeposits: state?.closed ? null : (state?.netDeposits ?? null),
      growth,
      growthApproximate: growth !== null && entries.some((entry) => entry.netDeposits === null),
    };
  }
}
