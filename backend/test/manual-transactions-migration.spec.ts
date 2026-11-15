import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('the manual transactions migration', () => {
  it('keeps offset refunds when the table is rebuilt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    const src = join(__dirname, '../src/db/migrations');
    cpSync(src, dir, { recursive: true });
    // First apply up to 0018 only.
    const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'));
    const full = structuredClone(journal);
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 18);
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: dir });
    sqlite.exec(`INSERT INTO connections (id, bank_name, session_id, valid_until) VALUES (1,'S','s',0);
   INSERT INTO accounts (id, connection_id, identification_hash, uid, name, type, currency) VALUES (1,1,'h','u','L','payment','SEK');
   INSERT INTO transactions (id, account_id, status, amount, currency, date, description, dedup_key, raw, fetched_at) VALUES (1,1,'booked',-10,'SEK','2026-11-01','a','k1','{}',0);
   INSERT INTO transactions (id, account_id, status, amount, currency, date, description, dedup_key, raw, fetched_at, offsets_transaction_id) VALUES (2,1,'booked',10,'SEK','2026-11-02','b','k2','{}',0,1);`);
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(full));
    migrate(db, { migrationsFolder: dir });
    expect(
      sqlite.prepare('select id, offsets_transaction_id from transactions order by id').all(),
    ).toEqual([
      { id: 1, offsets_transaction_id: null },
      { id: 2, offsets_transaction_id: 1 },
    ]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    rmSync(dir, { recursive: true });
  });
});
