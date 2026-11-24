import { addMonths } from '../calendar';

/** The value in force on `day`: that of the latest change on or before it, or null before any. */
export function inForce<T>(changes: { from: string; value: T }[], day: string): T | null {
  let latest: { from: string; value: T } | null = null;
  for (const change of changes) {
    if (change.from <= day && (latest === null || change.from > latest.from)) latest = change;
  }
  return latest === null ? null : latest.value;
}

/**
 * A recurring day's next date as of `today`: the date the owner set, or that date plus the
 * interval repeated until it is today or later. Counted from the set date each time, so a
 * 31st does not drift to the 28th after a short month.
 */
export function nextOccurrence(date: string, intervalMonths: number, today: string): string {
  let next = date;
  for (let steps = 1; next < today; steps += 1) next = addMonths(date, steps * intervalMonths);
  return next;
}

/**
 * Whether the owner should be asked for a loan part's new rate: its latest rate adjustment day has
 * come, on or after the part started, and no rate change is dated on or after it. The day that
 * last passed is `next` when that is today, else one interval before it.
 */
export function needsNewRate(
  part: { startedOn: string; endedOn: string | null; rateChanges: { from: string }[] },
  rateAdjustment: { next: string; intervalMonths: number },
  today: string,
): boolean {
  if (part.endedOn !== null) return false;
  const { next, intervalMonths } = rateAdjustment;
  const latest = next <= today ? next : addMonths(next, -intervalMonths);
  if (latest > today || latest < part.startedOn) return false;
  return !part.rateChanges.some((change) => change.from >= latest);
}

/** The debt across open parts and their debt-weighted average rate (%); null with no rated debt. */
export function mortgageTotals(parts: { debt: number; rate: number | null }[]): {
  totalDebt: number;
  averageRate: number | null;
} {
  let totalDebt = 0;
  let weighted = 0;
  let rated = 0;
  for (const { debt, rate } of parts) {
    totalDebt += debt;
    // A part with no rate yet is left out of the average rather than counted as 0 %.
    if (rate !== null) {
      rated += debt;
      weighted += debt * rate;
    }
  }
  return { totalDebt, averageRate: rated > 0 ? weighted / rated : null };
}
