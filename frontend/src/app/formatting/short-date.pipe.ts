import { Pipe, type PipeTransform } from '@angular/core';
import { APP_LOCALE } from './locale';

const WITHOUT_YEAR = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const WITH_YEAR = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Formats a calendar day (`YYYY-MM-DD`) briefly, e.g. `3 nov`. The year is added only when it
 * is not the current year (`3 nov 2025`).
 */
export function shortDate(day: string, today: Date = new Date()): string {
  const format = Number(day.slice(0, 4)) === today.getFullYear() ? WITHOUT_YEAR : WITH_YEAR;
  return format.format(new Date(`${day}T00:00:00Z`)).replaceAll('.', '');
}

/** Template form of {@link shortDate}, for lists, meta lines and inline mentions. */
@Pipe({ name: 'shortDate' })
export class ShortDatePipe implements PipeTransform {
  transform(day: string | null): string {
    return day === null ? '' : shortDate(day);
  }
}
