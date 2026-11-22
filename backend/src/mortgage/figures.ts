/** The value in force on `day`: that of the latest change on or before it, or null before any. */
export function inForce<T>(changes: { from: string; value: T }[], day: string): T | null {
  let latest: { from: string; value: T } | null = null;
  for (const change of changes) {
    if (change.from <= day && (latest === null || change.from > latest.from)) latest = change;
  }
  return latest === null ? null : latest.value;
}

/** `day` (`YYYY-MM-DD`) moved by whole months, clamped to the last day of a shorter month. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(
    Math.min(date, lastDay),
  ).padStart(2, '0')}`;
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
