/** A balance entry as the derivation needs it. */
export interface Entry {
  date: string;
  balance: number;
  netDeposits: number | null;
}

/** An account's balance and net deposits on a day. */
export interface State {
  balance: number;
  /** Null when no entry up to the day states net deposits (balance only, so far). */
  netDeposits: number | null;
  closed: boolean;
}

export interface Change {
  deposits: number;
  growth: number;
  /** An entry in the stretch left net deposits blank, so the whole change counted as growth. */
  approximate: boolean;
}

const byDate = (entries: readonly Entry[]) =>
  [...entries].sort((a, b) => a.date.localeCompare(b.date));

/**
 * The account on `day`: the latest entry on or before it, carried forward, with blank net
 * deposits meaning unchanged. Null before the first entry. From the day it closed it counts as
 * 0, as a sold-off account would.
 */
export function stateOn(
  entries: readonly Entry[],
  closedOn: string | null,
  day: string,
): State | null {
  let balance: number | null = null;
  let netDeposits: number | null = null;
  for (const entry of byDate(entries)) {
    if (entry.date > day) break;
    balance = entry.balance;
    netDeposits = entry.netDeposits ?? netDeposits;
  }
  if (balance === null) return null;
  return closedOn !== null && day >= closedOn
    ? { balance: 0, netDeposits: 0, closed: true }
    : { balance, netDeposits, closed: false };
}

/**
 * What changed in the stretch after `from` up to and including `to`: deposits, and growth as the
 * change in balance minus the deposits. A stretch that begins before the account's first entry
 * is measured from that entry, the start of its history. Null for a balance-only account.
 */
export function change(
  entries: readonly Entry[],
  closedOn: string | null,
  from: string,
  to: string,
): Change | null {
  const sorted = byDate(entries);
  const first = sorted[0];
  if (first === undefined) return null;
  const start = stateOn(sorted, closedOn, from > first.date ? from : first.date);
  const end = stateOn(sorted, closedOn, to);
  if (start === null || end === null) return null;
  if (start.netDeposits === null || end.netDeposits === null) return null;
  const deposits = end.netDeposits - start.netDeposits;
  const approximate =
    sorted.some((entry) => entry.date > from && entry.date <= to && entry.netDeposits === null) &&
    sorted.some((entry) => entry.netDeposits !== null);
  return { deposits, growth: end.balance - start.balance - deposits, approximate };
}
