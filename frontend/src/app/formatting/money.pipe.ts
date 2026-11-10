import { formatCurrency, getCurrencySymbol } from '@angular/common';
import { Pipe, type PipeTransform } from '@angular/core';
import { APP_LOCALE } from './locale';

/** Formats a sum of money in Swedish style, e.g. `-1234.5` → `−1 234,50 kr`. */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(amount: number, currency = 'SEK'): string {
    const symbol = getCurrencySymbol(currency, 'narrow', APP_LOCALE);
    return formatCurrency(amount, APP_LOCALE, symbol, currency, '1.2-2');
  }
}
