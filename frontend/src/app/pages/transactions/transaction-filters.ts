import type { ParamMap } from '@angular/router';
import { dayOf } from '../../dates';
import { parseAmount } from '../../formatting/amount';

/** What the owner searches and filters the transactions by; it lives in the URL's query string. */
export interface TransactionFilters {
  /** Part of the description. */
  q: string;
  /** Dates, `YYYY-MM-DD`, or an empty string for no bound. */
  from: string;
  to: string;
  /** Account ids, or `manual`. */
  accounts: string[];
  /** Category ids, or `none` for uncategorised. */
  categories: string[];
  /** Subcategory ids; set by links from the overview. */
  subcategories: string[];
  kind: '' | 'out' | 'in';
  /** Bounds of the absolute amount in kronor, or an empty string for none. */
  min: string;
  max: string;
}

export const EMPTY_FILTERS: TransactionFilters = {
  q: '',
  from: '',
  to: '',
  accounts: [],
  categories: [],
  subcategories: [],
  kind: '',
  min: '',
  max: '',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string | null): string {
  return value !== null && DAY.test(value) && !Number.isNaN(Date.parse(value)) ? value : '';
}

/** An amount bound as kept in the URL: dot decimals, at most two, or null if not a usable amount. */
export function amountBound(text: string): string | null {
  const parsed = parseAmount(text);
  if (parsed === null || parsed < 0 || parsed > 1e12) return null;
  return String(Math.round(parsed * 100) / 100);
}

function amount(value: string | null): string {
  return amountBound(value ?? '') ?? '';
}

function list(value: string | null, keyword: string): string[] {
  return (value ?? '').split(',').filter((part) => part === keyword || /^\d{1,15}$/.test(part));
}

/** Reads the filters from the query string; a value that is not valid counts as not set. */
export function filtersFromParams(params: ParamMap): TransactionFilters {
  const kind = params.get('kind');
  return {
    q: (params.get('q') ?? '').trim(),
    from: day(params.get('from')),
    to: day(params.get('to')),
    accounts: list(params.get('accounts'), 'manual'),
    categories: list(params.get('categories'), 'none'),
    subcategories: list(params.get('subcategories'), 'none').filter((part) => part !== 'none'),
    kind: kind === 'out' || kind === 'in' ? kind : '',
    min: amount(params.get('min')),
    max: amount(params.get('max')),
  };
}

/** The query string for the filters, which is also what `GET /api/transactions` takes. */
export function filtersToParams(filters: TransactionFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.q.trim() !== '') params['q'] = filters.q.trim();
  if (filters.from !== '') params['from'] = filters.from;
  if (filters.to !== '') params['to'] = filters.to;
  if (filters.accounts.length > 0) params['accounts'] = filters.accounts.join(',');
  if (filters.categories.length > 0) params['categories'] = filters.categories.join(',');
  if (filters.subcategories.length > 0) params['subcategories'] = filters.subcategories.join(',');
  if (filters.kind !== '') params['kind'] = filters.kind;
  if (filters.min !== '') params['min'] = filters.min;
  if (filters.max !== '') params['max'] = filters.max;
  return params;
}

/** The query string of the filters; two filter sets with the same key list the same transactions. */
export function filtersKey(filters: TransactionFilters): string {
  return new URLSearchParams(filtersToParams(filters)).toString();
}

/** How many of the panel's sections have a filter set; the search field is not one of them. */
export function activeFilterCount(filters: TransactionFilters): number {
  return [
    filters.from !== '' || filters.to !== '',
    filters.kind !== '',
    filters.min !== '' || filters.max !== '',
    filters.accounts.length > 0,
    filters.categories.length > 0 || filters.subcategories.length > 0,
  ].filter(Boolean).length;
}

export interface Period {
  from: string;
  to: string;
}

/** The quick periods, counted from `today` in the owner's own time. */
export function periodPresets(today: Date): { last7: Period; month: Period } {
  const weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  return {
    last7: { from: dayOf(weekAgo), to: '' },
    month: {
      from: dayOf(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: dayOf(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    },
  };
}

export function samePeriod(
  period: Period,
  filters: Pick<TransactionFilters, 'from' | 'to'>,
): boolean {
  return period.from === filters.from && period.to === filters.to;
}

export interface AmountPreset {
  label: string;
  min: string;
  max: string;
}

export const AMOUNT_PRESETS: readonly AmountPreset[] = [
  { label: 'Under 100 kr', min: '', max: '99.99' },
  { label: '100–500 kr', min: '100', max: '500' },
  { label: '500–2 000 kr', min: '500', max: '2000' },
  { label: 'Över 2 000 kr', min: '2000.01', max: '' },
];
