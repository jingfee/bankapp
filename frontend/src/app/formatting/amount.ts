import { formatNumber } from '@angular/common';
import { APP_LOCALE } from './locale';

/** Any space, including the no-break spaces Swedish formatting uses for thousands. */
const SPACES = /[\s\p{Zs}]/gu;
const MINUS_SIGN = /−/;
const AMOUNT = /^-?\d+([.,]\d+)?$/;

/**
 * Reads an amount the owner typed: Swedish style (`1 234,56`), tolerating a decimal dot.
 * Returns null when the text is not exactly one number.
 */
export function parseAmount(text: string): number | null {
  const compact = text.replace(SPACES, '').replace(MINUS_SIGN, '-');
  if (!AMOUNT.test(compact)) return null;
  return Number(compact.replace(',', '.'));
}

/** An amount as it is filled into an input: decimal comma, no thousands grouping (`1234,5`). */
export function formatAmountInput(amount: number): string {
  return formatNumber(amount, APP_LOCALE, '1.0-2').replace(SPACES, '');
}
