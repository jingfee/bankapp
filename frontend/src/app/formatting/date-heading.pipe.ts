import { Pipe, type PipeTransform } from '@angular/core';
import { APP_LOCALE } from './locale';

const FORMAT = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Formats a calendar day (`YYYY-MM-DD`) as a heading, e.g. `Tisdag 10 november 2026`. */
@Pipe({ name: 'dateHeading' })
export class DateHeadingPipe implements PipeTransform {
  transform(day: string): string {
    const text = FORMAT.format(new Date(`${day}T00:00:00Z`));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}
