import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { SHARE_OPTIONS } from './share-options';

/** Cached list of banks Enable Banking supports, replaced wholesale on every refresh. */
export const banks = sqliteTable('banks', {
  name: text('name').primaryKey(),
  country: text('country').notNull(),
  logoUrl: text('logo_url'),
  beta: integer('beta', { mode: 'boolean' }).notNull().default(false),
  maximumConsentSeconds: integer('maximum_consent_seconds').notNull(),
});

/** The owner's permission to read one bank. A bank has at most one. */
export const connections = sqliteTable('connections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bankName: text('bank_name').notNull().unique(),
  sessionId: text('session_id').notNull(),
  validUntil: integer('valid_until', { mode: 'timestamp_ms' }).notNull(),
});

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  connectionId: integer('connection_id')
    .notNull()
    .references(() => connections.id),
  identificationHash: text('identification_hash').notNull().unique(),
  uid: text('uid').notNull(),
  name: text('name').notNull(),
  type: text('type', { enum: ['payment', 'savings', 'card'] }).notNull(),
  currency: text('currency').notNull(),
  /** Set when a renewal no longer returns the account; it keeps its history but is not synced. */
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
  /** The owner hid the account: it is left off the overview and its transactions are not shown. */
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  /**
   * The share the owner bears of the account's transactions (ADR 0007); null when not set, which
   * shows as Jag but lets the subcategory's share apply. Choosing Jag on Banker clears it.
   */
  share: text('share', { enum: SHARE_OPTIONS }),
  /** The account as Enable Banking last returned it, as JSON; empty until first seen (ADR 0001). */
  raw: text('raw'),
});

/** A BankID login that has been started but not yet returned; `state` is the redirect's secret. */
export const authorisations = sqliteTable('authorisations', {
  state: text('state').primaryKey(),
  bankName: text('bank_name').notNull(),
  /** The owner asked to renew a connection that was still active. */
  renewal: integer('renewal', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Every balance the bank reported, kept for each sync (append-only). `amount` is already
 * normalised so that money owed is negative, also for card accounts.
 */
export const balances = sqliteTable('balances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id),
  /** ISO 20022 balance type as the bank reports it, e.g. `CLBD`. */
  type: text('type').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  /** The day the balance applies to (`YYYY-MM-DD`), when the bank says. */
  referenceDate: text('reference_date'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
});

/** One run of fetching data for the owner's accounts. `finishedAt` is null while it runs. */
export const syncRuns = sqliteTable('sync_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trigger: text('trigger', { enum: ['initial', 'scheduled', 'manual'] }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
});

/** How a sync run went for one account. */
export const syncAccountResults = sqliteTable('sync_account_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  syncRunId: integer('sync_run_id')
    .notNull()
    .references(() => syncRuns.id),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id),
  outcome: text('outcome', { enum: ['ok', 'failed', 'rate-limited'] }).notNull(),
  error: text('error'),
  /** Booked transactions this run stored that were not there before. */
  newTransactions: integer('new_transactions').notNull().default(0),
  syncedAt: integer('synced_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * Transactions as the bank reported them, with the raw response kept next to the parsed fields
 * (ADR 0001). Booked transactions are never deleted; pending ones are replaced on every sync.
 * The dedup rules are provisional until real data has been observed.
 */
export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    status: text('status', { enum: ['booked', 'pending'] }).notNull(),
    /** Negative when money leaves the account. */
    amount: real('amount').notNull(),
    currency: text('currency').notNull(),
    bookingDate: text('booking_date'),
    valueDate: text('value_date'),
    /** The day the owner made the transaction (`YYYY-MM-DD`), when the bank says. */
    transactionDate: text('transaction_date'),
    /**
     * The day the transaction is listed under (`YYYY-MM-DD`): transaction date, else value date,
     * else booking date, else the day it was fetched.
     */
    date: text('date').notNull(),
    description: text('description').notNull(),
    entryReference: text('entry_reference'),
    /** Identifies a booked transaction within its account; see `dedupKey` in the sync service. */
    dedupKey: text('dedup_key').notNull(),
    /** The transaction as the bank returned it, as JSON. */
    raw: text('raw').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
    /** What the transaction is categorised as; null when it is uncategorised. */
    subcategoryId: integer('subcategory_id').references(() => subcategories.id),
    /**
     * True when the owner decided the category: chose or accepted a subcategory, or removed it
     * (`subcategoryId` null). The app never changes or guesses it then.
     */
    categoryConfirmed: integer('category_confirmed', { mode: 'boolean' }).notNull().default(false),
    /** When the owner last chose or accepted the category; history reuses the most recent. */
    categoryConfirmedAt: integer('category_confirmed_at', { mode: 'timestamp_ms' }),
    /**
     * The purchase this money-in transaction is offset against (kvittad), or null. The refund
     * takes the purchase's subcategory and counts in the purchase's month (ADR 0006).
     */
    offsetsTransactionId: integer('offsets_transaction_id').references(
      (): AnySQLiteColumn => transactions.id,
    ),
    /** The owner's own share for this transaction; null defers to the account and subcategory. */
    share: text('share', { enum: SHARE_OPTIONS }),
  },
  (table) => [
    uniqueIndex('transactions_booked_dedup')
      .on(table.accountId, table.dedupKey)
      .where(sql`${table.status} = 'booked'`),
    index('transactions_account_date').on(table.accountId, table.date, table.id),
    index('transactions_subcategory_id').on(table.subcategoryId),
    index('transactions_offsets_transaction_id').on(table.offsetsTransactionId),
  ],
);

/**
 * What a transaction is categorised as, at the top level. `colour` is a name from the shared
 * palette and `icon` a name from the shared curated icon set. There is exactly one income and
 * one transfer category, both fixed.
 */
export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['expense', 'income', 'transfer'] }).notNull(),
    colour: text('colour').notNull(),
    icon: text('icon').notNull(),
    sortOrder: integer('sort_order').notNull(),
    fixed: integer('fixed', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    uniqueIndex('categories_one_income_or_transfer')
      .on(table.kind)
      .where(sql`kind <> 'expense'`),
  ],
);

/** A second-level grouping; it has its category's colour and kind. */
export const subcategories = sqliteTable(
  'subcategories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    icon: text('icon').notNull(),
    sortOrder: integer('sort_order').notNull(),
    /** The share of its transactions the owner bears; null defers to the default, Jag. */
    share: text('share', { enum: SHARE_OPTIONS }),
  },
  (table) => [index('subcategories_category_id').on(table.categoryId)],
);

/**
 * The household ratio (ADR 0011): the owner's whole percentage of costs shared as Hushåll, in
 * force from `from` (`YYYY-MM-DD`) until the next entry.
 */
export const householdRatios = sqliteTable('household_ratios', {
  from: text('from').primaryKey(),
  percent: integer('percent').notNull(),
});

/** One-off jobs the app runs once at startup, such as guessing categories for stored history. */
export const startupTasks = sqliteTable('startup_tasks', {
  name: text('name').primaryKey(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }).notNull(),
});
