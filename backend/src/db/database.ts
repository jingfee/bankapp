import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as schema from './schema';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export const DATABASE_FILE_NAME = 'bankapp.db';
const migrationsFolder = resolve(__dirname, 'migrations');

/** Opens (creating if needed) the SQLite database and applies pending migrations. */
export function openDatabase(location: { dataDir: string } | { inMemory: true }): {
  db: AppDatabase;
  close: () => void;
} {
  let file = ':memory:';
  if ('dataDir' in location) {
    mkdirSync(location.dataDir, { recursive: true });
    file = join(location.dataDir, DATABASE_FILE_NAME);
  }
  const sqlite = new Database(file);
  if (file !== ':memory:') sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, close: () => sqlite.close() };
}
