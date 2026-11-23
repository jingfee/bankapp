import { Pipe, type PipeTransform } from '@angular/core';
import { APP_LOCALE } from './locale';

/** The owner's timezone; times are shown in it whatever the device's timezone is. */
export const APP_TIMEZONE = 'Europe/Stockholm';

const DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: APP_TIMEZONE });
const TIME = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const DATE = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  day: 'numeric',
  month: 'short',
});
const DATE_WITH_YEAR = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Formats an ISO 8601 timestamp the Swedish way, in the owner's timezone: `idag 11:00`,
 * `igår 11:00`, otherwise `22 nov 11:00`, with the year only when it is not the current year.
 */
export function dateTime(timestamp: string, now: Date = new Date()): string {
  const at = new Date(timestamp);
  const day = DAY.format(at);
  const time = TIME.format(at);
  if (day === DAY.format(now)) return `idag ${time}`;
  if (day === DAY.format(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return `igår ${time}`;
  const sameYear = day.slice(0, 4) === DAY.format(now).slice(0, 4);
  return `${(sameYear ? DATE : DATE_WITH_YEAR).format(at).replaceAll('.', '')} ${time}`;
}

@Pipe({ name: 'dateTime' })
export class DateTimePipe implements PipeTransform {
  transform(timestamp: string): string {
    return dateTime(timestamp);
  }
}
