import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Cached list of banks Enable Banking supports, replaced wholesale on every refresh. */
export const banks = sqliteTable('banks', {
  name: text('name').primaryKey(),
  country: text('country').notNull(),
  logoUrl: text('logo_url'),
  beta: integer('beta', { mode: 'boolean' }).notNull().default(false),
});
