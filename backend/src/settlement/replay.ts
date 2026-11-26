import type {
  BalanceSetting,
  CategoryColour,
  CategoryIcon,
  ShareOption,
  SettlementItem,
  SettlementPeriod,
  SettlementResponse,
} from '@bankapp/shared';
import { endedDaysAgo, isDay, isMonth, nextDay } from '../calendar';
import { WELL_KNOWN_SUBCATEGORIES } from '../well-known-subcategories';
import { InvalidInput, NoCloseToUndo } from '../domain-errors';
import { ownerPart, roundOre } from '../transactions/owners-part';
import type { CloseMonthRequest } from '@bankapp/shared';

/** A balance setting as made; `id` orders them by when they were made. */
export interface ReplaySetting {
  id: number;
  amount: number;
  asOf: string;
}

/** A transaction row with its share already resolved. */
export interface ReplayTransaction {
  id: number;
  date: string;
  description: string;
  amount: number;
  paidBy: string;
  status: 'booked' | 'pending';
  shareOption: ShareOption;
  /** The owner's whole percentage under `shareOption`. */
  sharePercent: number;
  /** The category's kind; null while uncategorised. */
  kind: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
  /** Null for a manual transaction. */
  accountName: string | null;
  icon: CategoryIcon | null;
  colour: CategoryColour | null;
}

/** A `settlement_months` row: the last has no `closedThrough` and is the open period. */
export interface PeriodRow {
  month: string;
  closedThrough: string | null;
}

export interface ReplayInput {
  settings: ReplaySetting[];
  transactions: ReplayTransaction[];
  periods: PeriodRow[];
  today: string;
}

/** A period before the service has looked on disk for its report. */
export type ReplayPeriod = Omit<SettlementPeriod, 'reportSaved'>;

export interface SettlementReplay extends Omit<SettlementResponse, 'periods'> {
  periods: ReplayPeriod[];
}

/** What a manual transaction shows where an account's name would be. */
export const MANUAL_ACCOUNT_NAME = 'Manuell';

/** The open month ended this many days ago, or more: the owner is reminded to close it. */
const OVERDUE_AFTER_DAYS = 7;

/** What the replay of one transaction or setting needs: where it falls and what it adds to the balance. */
interface Event {
  date: string;
  /** A balance setting comes before the transactions of its day. */
  order: 0 | 1;
  id: number;
  setting?: BalanceSetting;
  item?: SettlementItem;
  /** Set for a settlement: what it paid. */
  paid?: number;
}

/**
 * The settlement balance, its periods (newest first) and every balance setting (newest first),
 * replayed from the facts (ADRs 0008, 0014). With no period rows it acts as if one open period
 * existed, named after `today`'s month.
 */
export function replaySettlement(input: ReplayInput): SettlementReplay {
  const { today } = input;
  const made = input.settings.toSorted((a, b) => a.id - b.id);
  if (made.length === 0) return { balance: null, periods: [], balanceSettings: [] };
  const settings = effectiveSettings(made);
  const rows =
    input.periods.length > 0 ? input.periods : [{ month: today.slice(0, 7), closedThrough: null }];

  const events: Event[] = settings.map((setting) => ({
    date: setting.asOf,
    order: 0,
    id: setting.id,
    setting: { amount: setting.amount, asOf: setting.asOf },
  }));
  for (const transaction of input.transactions) {
    if (transaction.date < settings[0]!.asOf) continue;
    const event = transactionEvent(transaction);
    if (event) events.push(event);
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id - b.id);

  let running: number | null = null;
  let index = 0;
  let period = emptyPeriod(rows[0]!, 0, today, null);
  const built: ReplayPeriod[] = [];
  /** Ends the current period and starts the next one, which carries the balance on. */
  const closeCurrent = () => {
    built.push({ ...period, carriedOut: running ?? 0 });
    index += 1;
    period = emptyPeriod(rows[index]!, running ?? 0, today, rows[index - 1]!.closedThrough);
  };
  /** Moves on past every closed period that ended before `date`. */
  const advanceTo = (date: string) => {
    while (rows[index]!.closedThrough !== null && date > rows[index]!.closedThrough!)
      closeCurrent();
  };
  for (const event of events) {
    advanceTo(event.date);
    if (event.setting) {
      running = event.setting.amount;
      period.balanceSettings.push(event.setting);
      continue;
    }
    const item = event.item!;
    running = roundOre(running! + item.partnerPart);
    if (event.paid === undefined) {
      period.items.push(item);
      continue;
    }
    period.payments.push({
      transactionId: item.transactionId,
      date: item.date,
      description: item.description,
      amount: event.paid,
    });
    period.paid = roundOre(period.paid + event.paid);
  }
  while (index < rows.length - 1) closeCurrent();
  built.push({ ...period, carriedOut: running! });
  return {
    balance: running,
    periods: built.reverse(),
    balanceSettings: made.map(({ amount, asOf }): BalanceSetting => ({ amount, asOf })).reverse(),
  };
}

/** The event of a transaction that moves the balance, or null for one that does not. */
function transactionEvent(transaction: ReplayTransaction): Event | null {
  if (!movesBalance(transaction.kind, transaction.subcategoryName)) return null;
  const isSettlement = transaction.kind === 'transfer';
  const paidByPartner = transaction.paidBy === 'partner';
  if (!isSettlement && !paidByPartner && transaction.sharePercent === 100) return null;
  // The partner's part of what the owner paid; the owner's part of what the partner paid.
  const ownersPart = ownerPart(transaction.amount, transaction.sharePercent);
  const partnerPart = isSettlement
    ? -transaction.amount
    : paidByPartner
      ? ownersPart
      : roundOre(ownersPart - transaction.amount);
  return {
    date: transaction.date,
    order: 1,
    id: transaction.id,
    paid: isSettlement ? transaction.amount : undefined,
    item: {
      transactionId: transaction.id,
      date: transaction.date,
      description: transaction.description,
      accountName: transaction.accountName ?? MANUAL_ACCOUNT_NAME,
      icon: transaction.icon,
      colour: transaction.colour,
      amount: transaction.amount,
      share: transaction.shareOption,
      ownerPercent: transaction.sharePercent,
      category: transaction.categoryName,
      subcategory: transaction.subcategoryName,
      paidBy: paidByPartner ? 'partner' : 'owner',
      status: transaction.status,
      partnerPart,
    },
  };
}

/** Among transfers only the settlements (Avräkning) move the balance. */
function movesBalance(kind: string | null, subcategoryName: string | null): boolean {
  return kind !== 'transfer' || subcategoryName === WELL_KNOWN_SUBCATEGORIES.settlement.name;
}

function emptyPeriod(
  row: PeriodRow,
  carriedIn: number,
  today: string,
  previousClosedThrough: string | null,
): ReplayPeriod {
  return {
    month: row.month,
    closedThrough: row.closedThrough,
    startsOn: previousClosedThrough === null ? null : nextDay(previousClosedThrough),
    carriedIn,
    balanceSettings: [],
    items: [],
    payments: [],
    paid: 0,
    carriedOut: carriedIn,
    overdue: row.closedThrough === null && endedDaysAgo(row.month, today) >= OVERDUE_AFTER_DAYS,
  };
}

/** The latest setting made replaces every earlier one from its day on. */
function effectiveSettings(inOrderMade: ReplaySetting[]): ReplaySetting[] {
  let kept: ReplaySetting[] = [];
  for (const setting of inOrderMade) kept = [...kept.filter((s) => s.asOf < setting.asOf), setting];
  return kept;
}

/**
 * The periods oldest first; the last is the open one. With no rows the open period is virtual,
 * named after `today`'s month.
 */
function rowsOrVirtual(periods: PeriodRow[], today: string): PeriodRow[] {
  return periods.length > 0 ? periods : [{ month: today.slice(0, 7), closedThrough: null }];
}

/** Checks a request to close the open period; returns it narrowed to what it must hold (_Avsluta månad_). */
export function checkClose(
  periods: PeriodRow[],
  request: Partial<CloseMonthRequest> | undefined,
  today: string,
): CloseMonthRequest {
  const { closedThrough, nextMonth } = request ?? {};
  if (typeof closedThrough !== 'string' || !isDay(closedThrough)) {
    throw new InvalidInput('closedThrough must be a day as YYYY-MM-DD');
  }
  if (typeof nextMonth !== 'string' || !isMonth(nextMonth)) {
    throw new InvalidInput('nextMonth must be a month as YYYY-MM');
  }
  if (closedThrough > today) throw new InvalidInput('closedThrough cannot be in the future');
  const rows = rowsOrVirtual(periods, today);
  const previous = rows.at(-2)?.closedThrough;
  if (previous && closedThrough < previous) {
    throw new InvalidInput(`closedThrough cannot be before the previous close, ${previous}`);
  }
  const openMonth = rows.at(-1)!.month;
  if (nextMonth <= openMonth) throw new InvalidInput(`nextMonth must be later than ${openMonth}`);
  return { closedThrough, nextMonth };
}

/** Checks a new month for the open period: months strictly increase from one period to the next. */
export function checkOpenMonth(periods: PeriodRow[], month: unknown): string {
  if (typeof month !== 'string' || !isMonth(month)) {
    throw new InvalidInput('month must be a month as YYYY-MM');
  }
  const previous = periods.at(-2);
  if (previous && month <= previous.month) {
    throw new InvalidInput(`month must be later than ${previous.month}`);
  }
  return month;
}

/** Only a period that has been closed can be reopened. */
export function checkUndoClose(periods: PeriodRow[]): void {
  if (periods.length < 2) throw new NoCloseToUndo();
}
