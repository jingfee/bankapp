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
