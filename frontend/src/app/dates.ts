/** Milliseconds in a day. */
export const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of a date in the owner's own time. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Today as `YYYY-MM-DD` in the owner's own time zone. */
export function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/** `YYYY-MM` of a date in the owner's own time. */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The month `by` months from `month` (`YYYY-MM`). */
export function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return monthOf(new Date(year, number - 1 + by, 1));
}

/** Whether `value` is a month as `YYYY-MM`. */
export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Last day of `month` (`YYYY-MM`). */
export function lastDayOf(month: string): string {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return last.toISOString().slice(0, 10);
}
