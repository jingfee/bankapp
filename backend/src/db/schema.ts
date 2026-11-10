import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Cached list of banks Enable Banking supports, replaced wholesale on every refresh. */
export const banks = sqliteTable('banks', {
  name: text('name').primaryKey(),
  country: text('country').notNull(),
  logoUrl: text('logo_url'),
  beta: integer('beta', { mode: 'boolean' }).notNull().default(false),
  maximumConsentSeconds: integer('maximum_consent_seconds').notNull(),
  personnummer: text('personnummer', { enum: ['none', 'optional', 'required'] }).notNull(),
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
});

/** A BankID login that has been started but not yet returned; `state` is the redirect's secret. */
export const authorisations = sqliteTable('authorisations', {
  state: text('state').primaryKey(),
  bankName: text('bank_name').notNull(),
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
    /** The day the transaction is listed under (`YYYY-MM-DD`): booking date, else value date, else the day it was fetched. */
    date: text('date').notNull(),
    description: text('description').notNull(),
    entryReference: text('entry_reference'),
    /** Identifies a booked transaction within its account; see `dedupKey` in the sync service. */
    dedupKey: text('dedup_key').notNull(),
    /** The transaction as the bank returned it, as JSON. */
    raw: text('raw').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('transactions_booked_dedup')
      .on(table.accountId, table.dedupKey)
      .where(sql`${table.status} = 'booked'`),
    index('transactions_account_date').on(table.accountId, table.date, table.id),
  ],
);
