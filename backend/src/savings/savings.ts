import { Inject, Injectable } from '@nestjs/common';
import type {
  SavingsAccount,
  SavingsMonth,
  SavingsReminder,
  SavingsResponse,
  SavingsTotals,
} from '@bankapp/shared';
import { asc, eq } from 'drizzle-orm';
import { savingsFigures } from '../accounts/savings-figures';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config';
import { CLOCK, clock, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { accounts, balances, connections } from '../db/schema';
import { ManualSavings } from '../manual-savings/manual-savings';
import { change, stateOn, type Entry } from '../manual-savings/figures';

/** Which balance a fetch shows, most preferred first; the same as on Banker. */
const BALANCE_PREFERENCE = ['CLBD', 'ITBD', 'ITAV'];

const round = (value: number) => Math.round(value * 100) / 100;

/** One account as the series needs it: its history as entries, whichever kind it is. */
interface Source {
  account: Omit<
    SavingsAccount,
    'balance' | 'netDeposits' | 'growth' | 'growthPercent' | 'approximate' | 'lastUpdated'
  >;
  entries: Entry[];
  lastUpdated: string | null;
  /** Growth is a rough figure because an entry left net deposits blank. */
  approximate: boolean;
}

const monthOf = (day: string) => day.slice(0, 7);

function nextMonth(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

function previousMonth(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
}

/** The last day of a `YYYY-MM` month. */
function monthEnd(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** The savings view: every savings account, connected or manual, over time (`CONTEXT.md` › Savings). */
@Injectable()
export class Savings {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly manual: ManualSavings,
  ) {}

  overview(): SavingsResponse {
    const today = this.clock.today();
    const sources = [...this.connectedSources(), ...this.manualSources()];
    const accountsList = sources.map((source) => this.summary(source, today));
    const months = this.months(sources, today);
    return {
      accounts: accountsList,
      months,
      totals: this.totals(accountsList),
      reminders: this.reminders(today),
    };
  }

  /** Connected savings accounts, with a point per month from the balances the syncs fetched. */
  private connectedSources(): Source[] {
    const rows = this.db
      .select({
        id: accounts.id,
        name: accounts.name,
        bank: connections.bankName,
        closed: accounts.closed,
        removedAt: connections.removedAt,
      })
      .from(accounts)
      .innerJoin(connections, eq(accounts.connectionId, connections.id))
      .where(eq(accounts.savings, true))
      .orderBy(asc(accounts.id))
      .all();
    return rows.flatMap((row) => {
      const points = this.balancePoints(row.id);
      const first = points[0];
      const last = points.at(-1);
      if (first === undefined || last === undefined) return [];
      // The bank does not say when an account closed; the last balance it gave is the last day it
      // was known to exist, and from then it counts as 0, as a sold-off account would.
      const isClosed = row.closed || row.removedAt !== null;
      // The bank's history before the app began following the account is unknown, so the balance
      // at the first sync is taken as what had been put in by then; later deposits and withdrawals
      // are added to it. Growth is thereby measured from when the app began following the account.
      const atFirst = savingsFigures(this.db, row.id, first.day, first.amount).netDeposits;
      const entries: Entry[] = points.map((point) => ({
        date: point.day,
        balance: point.amount,
        netDeposits: round(
          first.amount +
            savingsFigures(this.db, row.id, point.day, point.amount).netDeposits -
            atFirst,
        ),
      }));
      return [
        {
          account: {
            key: `connected-${row.id}`,
            name: row.name,
            institution: row.bank,
            kind: 'connected' as const,
            manualId: null,
            closedOn: isClosed ? last.day : null,
          },
          entries,
          lastUpdated: last.day,
          approximate: false,
        },
      ];
    });
  }

  /**
   * The balance the app shows on the first day a sync fetched one and on the last such day of each
   * month, oldest first: the series is monthly, so no more is needed.
   */
  private balancePoints(accountId: number): { day: string; amount: number }[] {
    const rows = this.db
      .select({
        type: balances.type,
        amount: balances.amount,
        referenceDate: balances.referenceDate,
        fetchedAt: balances.fetchedAt,
      })
      .from(balances)
      .where(eq(balances.accountId, accountId))
      .orderBy(asc(balances.fetchedAt), asc(balances.id))
      .all();
    const rank = (type: string) => {
      const index = BALANCE_PREFERENCE.indexOf(type);
      return index === -1 ? BALANCE_PREFERENCE.length : index;
    };
    const dayOf = (at: Date) => clock(() => at, this.config.timezone).today();
    // The best balance of each fetch; a later fetch of the same day replaces an earlier one.
    const byFetch = new Map<number, { type: string; amount: number }>();
    for (const row of rows) {
      const best = byFetch.get(row.fetchedAt.getTime());
      if (best === undefined || rank(row.type) < rank(best.type)) {
        byFetch.set(row.fetchedAt.getTime(), { type: row.type, amount: row.amount });
      }
    }
    const byDay = new Map<string, number>();
    for (const [at, balance] of byFetch) byDay.set(dayOf(new Date(at)), balance.amount);
    const days = [...byDay.keys()].sort();
    const lastOfMonth = new Map<string, string>();
    for (const day of days) lastOfMonth.set(monthOf(day), day);
    const wanted = new Set([...(days[0] === undefined ? [] : [days[0]]), ...lastOfMonth.values()]);
    return [...wanted].sort().map((day) => ({ day, amount: byDay.get(day)! }));
  }

  private manualSources(): Source[] {
    return this.manual.list().accounts.map((account) => ({
      account: {
        key: `manual-${account.id}`,
        name: account.name,
        institution: account.institution,
        kind: 'manual' as const,
        manualId: account.id,
        closedOn: account.closedOn,
      },
      entries: account.entries,
      lastUpdated: account.entries[0]?.date ?? null,
      approximate: account.growthApproximate,
    }));
  }

  private summary(source: Source, today: string): SavingsAccount {
    const { account, entries } = source;
    const state = stateOn(entries, account.closedOn, today);
    const open = state !== null && !state.closed;
    const netDeposits = open ? state.netDeposits : null;
    const growth = netDeposits === null ? null : round(state!.balance - netDeposits);
    return {
      ...account,
      balance: state?.balance ?? null,
      netDeposits,
      growth,
      growthPercent:
        growth !== null && netDeposits! > 0 ? round((growth / netDeposits!) * 100) : null,
      approximate: growth !== null && source.approximate,
      lastUpdated: source.lastUpdated,
    };
  }

  /** One point per month from the first known balance to the current month. */
  private months(sources: Source[], today: string): SavingsMonth[] {
    const firsts = sources.flatMap((source) => {
      const first = [...source.entries].sort((a, b) => a.date.localeCompare(b.date))[0];
      return first === undefined ? [] : [first.date];
    });
    if (firsts.length === 0) return [];
    const thisMonth = monthOf(today);
    const result: SavingsMonth[] = [];
    for (let month = monthOf(firsts.sort()[0]!); month <= thisMonth; month = nextMonth(month)) {
      // The current month uses the latest value rather than a month end still to come.
      const end = month === thisMonth ? today : monthEnd(month);
      const before = monthEnd(previousMonth(month));
      const points = sources.flatMap((source) => {
        const state = stateOn(source.entries, source.account.closedOn, end);
        if (state === null) return [];
        const delta = change(source.entries, source.account.closedOn, before, end);
        return [{ source, state, delta }];
      });
      if (points.length === 0) continue;
      const withDeposits = points.filter((point) => point.state.netDeposits !== null);
      const withGrowth = points.filter((point) => point.delta !== null);
      result.push({
        month,
        accounts: points.map(({ source, state, delta }) => ({
          key: source.account.key,
          balance: state.balance,
          netDeposits: state.netDeposits,
          growth: delta === null ? null : round(delta.growth),
        })),
        balance: round(points.reduce((sum, point) => sum + point.state.balance, 0)),
        netDeposits:
          withDeposits.length === 0
            ? null
            : round(withDeposits.reduce((sum, point) => sum + point.state.netDeposits!, 0)),
        growth:
          withGrowth.length === 0
            ? null
            : round(withGrowth.reduce((sum, point) => sum + point.delta!.growth, 0)),
        approximate: withGrowth.some((point) => point.delta!.approximate),
      });
    }
    return result;
  }

  private totals(list: SavingsAccount[]): SavingsTotals {
    const open = list.filter((account) => account.closedOn === null);
    const tracked = open.filter((account) => account.netDeposits !== null);
    const netDeposits =
      tracked.length === 0 ? null : round(tracked.reduce((sum, a) => sum + a.netDeposits!, 0));
    const growth =
      tracked.length === 0 ? null : round(tracked.reduce((sum, a) => sum + a.growth!, 0));
    return {
      balance: round(open.reduce((sum, account) => sum + (account.balance ?? 0), 0)),
      netDeposits,
      growth,
      growthPercent:
        growth !== null && netDeposits! > 0 ? round((growth / netDeposits!) * 100) : null,
      approximate: tracked.some((account) => account.approximate),
    };
  }

  /**
   * Open manual accounts with entries, none of them dated in the last calendar month or later:
   * that month has ended without the owner stating the balance.
   */
  private reminders(today: string): SavingsReminder[] {
    const ended = previousMonth(monthOf(today));
    return this.manual
      .list()
      .accounts.filter(
        (account) =>
          account.closedOn === null &&
          account.entries.length > 0 &&
          !account.entries.some((entry) => monthOf(entry.date) >= ended),
      )
      .map((account) => ({ key: `manual-${account.id}`, name: account.name, month: ended }));
  }
}
