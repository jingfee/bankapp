import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
});

/** A BankID login that has been started but not yet returned; `state` is the redirect's secret. */
export const authorisations = sqliteTable('authorisations', {
  state: text('state').primaryKey(),
  bankName: text('bank_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});
