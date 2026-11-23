import { Pipe, type PipeTransform } from '@angular/core';
import { APP_LOCALE } from './locale';

const FORMAT = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Formats a calendar day (`YYYY-MM-DD`) briefly, e.g. `10 nov. 2026`, for rows in a list. */
@Pipe({ name: 'dateShort' })
export class ShortDatePipe implements PipeTransform {
  transform(day: string): string {
    return FORMAT.format(new Date(`${day}T00:00:00Z`));
  }
}
