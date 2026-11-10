import { registerLocaleData } from '@angular/common';
import localeSv from '@angular/common/locales/sv';

/** The app is Swedish only; every date and amount is formatted with this locale. */
export const APP_LOCALE = 'sv-SE';

registerLocaleData(localeSv, APP_LOCALE);
