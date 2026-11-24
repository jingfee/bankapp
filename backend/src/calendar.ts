/**
 * Month and day arithmetic on `YYYY-MM` and `YYYY-MM-DD` strings, in UTC, so a day is the same
 * day on every machine. The one home for these helpers in the backend (ADR 0016).
 */

/** Milliseconds in a day. */
export const DAY_MS = 86_400_000;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

const partsOf = (month: string) => month.split('-').map(Number) as [number, number];

/** Whether `value` is a month as `YYYY-MM`. */
export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Whether `value` is a real calendar day as `YYYY-MM-DD`. */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** The month (`YYYY-MM`) of `day` (`YYYY-MM-DD`). */
export const monthOfDay = (day: string): string => day.slice(0, 7);

/** The month `by` months from `month` (`YYYY-MM`). */
export function shiftMonth(month: string, by: number): string {
  const [year, number] = partsOf(month);
  const index = year * 12 + (number - 1) + by;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

/** The month after `month`. */
export const nextMonth = (month: string): string => shiftMonth(month, 1);

/** The month before `month`. */
export const previousMonth = (month: string): string => shiftMonth(month, -1);

/** The day after `day` (`YYYY-MM-DD`). */
export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** The last day of `month` (`YYYY-MM`). */
export function monthEnd(month: string): string {
  const [year, number] = partsOf(month);
  return `${month}-${pad(new Date(Date.UTC(year, number, 0)).getUTCDate())}`;
}

/** How many days `month` (`YYYY-MM`) has. */
export function daysInMonth(month: string): number {
  return Number(monthEnd(month).slice(8, 10));
}

/** Whole days from the last day of `month` to `today` (negative while the month is running). */
export function endedDaysAgo(month: string, today: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${monthEnd(month)}T00:00:00Z`)) / DAY_MS,
  );
}

/** `day` (`YYYY-MM-DD`) moved by whole months, clamped to the last day of a shorter month. */
export function addMonths(day: string, months: number): string {
  const date = Number(day.slice(8, 10));
  const target = shiftMonth(day.slice(0, 7), months);
  return `${target}-${pad(Math.min(date, daysInMonth(target)))}`;
}
