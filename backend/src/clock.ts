export const CLOCK = Symbol('CLOCK');

/** The current time, and the owner's day. */
export interface Clock {
  now(): Date;
  /** Today as `YYYY-MM-DD` in the owner's timezone (`TIMEZONE`), whatever the process's `TZ`. */
  today(): string;
}

/** A clock reading `now`, whose days are those of `timeZone`. */
export function clock(now: () => Date, timeZone: string): Clock {
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short' });
  return { now, today: () => format.format(now()) };
}

/** Whether `value` is a real calendar day as `YYYY-MM-DD`. */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
