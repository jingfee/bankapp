import { Pipe, type PipeTransform } from '@angular/core';
import { APP_LOCALE } from './locale';

/** The owner's timezone; times are shown in it whatever the device's timezone is. */
export const APP_TIMEZONE = 'Europe/Stockholm';

const FORMAT = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIMEZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Formats an ISO 8601 timestamp the Swedish way, e.g. `10 nov. 13:00`. */
@Pipe({ name: 'dateTime' })
export class DateTimePipe implements PipeTransform {
  transform(timestamp: string): string {
    return FORMAT.format(new Date(timestamp)).replace(',', '');
  }
}
