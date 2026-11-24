import { and, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { isDay } from '../calendar';
import { categories, transactions } from '../db/schema';

/** What the owner searches and filters transactions by; every part is optional and they combine with AND. */
export interface TransactionFilter {
  /** A piece of the description. */
  q?: string;
  /** Transaction dates, inclusive (`YYYY-MM-DD`). */
  from?: string;
  to?: string;
  accountIds?: number[];
  /** Whether manual transactions, which have no account, are included in `accountIds`. */
  manual?: boolean;
  categoryIds?: number[];
  /** Subcategory ids; combines with `categoryIds` by AND. */
  subcategoryIds?: number[];
  /** Whether uncategorised transactions are included in `categoryIds`. */
  uncategorised?: boolean;
  kind?: 'out' | 'in';
  /** Bounds of the absolute amount, in kronor. */
  min?: number;
  max?: number;
}

/** The raw query parameters of `GET /api/transactions` that filter. */
export type FilterQuery = Partial<
  Record<
    'q' | 'from' | 'to' | 'accounts' | 'categories' | 'subcategories' | 'kind' | 'min' | 'max',
    unknown
  >
>;

/** Reads the query parameters; a message says what is wrong with one that is not valid. */
export function parseFilter(query: FilterQuery): TransactionFilter | { error: string } {
  const filter: TransactionFilter = {};
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && typeof value !== 'string') {
      return { error: `${name} must be given once` };
    }
  }
  const {
    q,
    from,
    to,
    accounts,
    categories: cats,
    subcategories: subs,
    kind,
    min,
    max,
  } = query as Record<string, string | undefined>;

  if (q !== undefined && q.trim() !== '') filter.q = q.trim();
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value === undefined) continue;
    if (!isDay(value)) return { error: `${name} must be a day, YYYY-MM-DD` };
    filter[name] = value;
  }

  if (accounts !== undefined) {
    const ids: number[] = [];
    for (const part of accounts.split(',')) {
      if (part === 'manual') filter.manual = true;
      else if (isId(part)) ids.push(Number(part));
      else return { error: 'accounts must be account ids or manual, separated by commas' };
    }
    filter.accountIds = ids;
  }

  if (cats !== undefined) {
    const ids: number[] = [];
    for (const part of cats.split(',')) {
      if (part === 'none') filter.uncategorised = true;
      else if (isId(part)) ids.push(Number(part));
      else return { error: 'categories must be category ids or none, separated by commas' };
    }
    filter.categoryIds = ids;
  }

  if (subs !== undefined) {
    const parts = subs.split(',');
    if (!parts.every(isId))
      return { error: 'subcategories must be subcategory ids, separated by commas' };
    filter.subcategoryIds = parts.map(Number);
  }

  if (kind !== undefined) {
    if (kind !== 'out' && kind !== 'in') return { error: 'kind must be out or in' };
    filter.kind = kind;
  }

  for (const [name, value] of [
    ['min', min],
    ['max', max],
  ] as const) {
    if (value === undefined) continue;
    const amount = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(amount)) return { error: `${name} must be an amount in kronor` };
    filter[name] = amount;
  }
  return filter;
}

/** The condition a transaction must meet; the query must join the subcategory's category. */
export function filterCondition(filter: TransactionFilter): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (filter.q !== undefined) {
    conditions.push(
      sql`instr(unicode_lower(${transactions.description}), ${filter.q.toLowerCase()}) > 0`,
    );
  }
  if (filter.from !== undefined) conditions.push(gte(transactions.date, filter.from));
  if (filter.to !== undefined) conditions.push(lte(transactions.date, filter.to));
  if (filter.accountIds !== undefined) {
    conditions.push(
      or(
        inArray(transactions.accountId, filter.accountIds),
        filter.manual ? isNull(transactions.accountId) : undefined,
      ),
    );
  }
  if (filter.categoryIds !== undefined) {
    conditions.push(
      or(
        inArray(categories.id, filter.categoryIds),
        filter.uncategorised ? isNull(transactions.subcategoryId) : undefined,
      ),
    );
  }
  if (filter.subcategoryIds !== undefined) {
    conditions.push(inArray(transactions.subcategoryId, filter.subcategoryIds));
  }
  if (filter.kind === 'out') conditions.push(sql`${transactions.amount} < 0`);
  if (filter.kind === 'in') conditions.push(sql`${transactions.amount} > 0`);
  if (filter.min !== undefined) conditions.push(sql`abs(${transactions.amount}) >= ${filter.min}`);
  if (filter.max !== undefined) conditions.push(sql`abs(${transactions.amount}) <= ${filter.max}`);
  return and(...conditions);
}

function isId(value: string): boolean {
  return /^\d{1,15}$/.test(value);
}
