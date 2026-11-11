import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = join(__dirname, '../src/db/migrations');
const migrations = readdirSync(folder)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const target = migrations.findIndex((name) => name.includes('transaction_date'));

function apply(sqlite: Database.Database, names: string[]): void {
  for (const name of names) {
    for (const statement of readFileSync(join(folder, name), 'utf8').split(
      '--> statement-breakpoint',
    )) {
      sqlite.exec(statement);
    }
  }
}

describe('the transaction date migration', () => {
  it('re-dates stored transactions from their raw response', () => {
    const sqlite = new Database(':memory:');
    apply(sqlite, migrations.slice(0, target));
    sqlite.exec(`
      INSERT INTO connections (id, bank_name, session_id, valid_until) VALUES (1, 'Swedbank', 's', 0);
      INSERT INTO accounts (id, connection_id, identification_hash, uid, name, type, currency)
        VALUES (1, 1, 'h', 'u', 'Lönekonto', 'payment', 'SEK');`);
    const insert = sqlite.prepare(`
      INSERT INTO transactions
        (account_id, status, amount, currency, booking_date, value_date, date, description, dedup_key, raw, fetched_at)
      VALUES (1, 'booked', -10, 'SEK', ?, ?, ?, ?, ?, ?, 0)`);
    // As the earlier version stored them: listed by booking date, with the transaction date
    // standing in as the value date when the bank gave none.
    insert.run(
      '2026-11-09',
      '2026-11-08',
      '2026-11-09',
      'all three',
      'k1',
      JSON.stringify({
        booking_date: '2026-11-09',
        value_date: '2026-11-08',
        transaction_date: '2026-11-07',
      }),
    );
    insert.run(
      '2026-11-09',
      '2026-11-07',
      '2026-11-09',
      'no value date',
      'k2',
      JSON.stringify({ booking_date: '2026-11-09', transaction_date: '2026-11-07' }),
    );
    insert.run(
      '2026-11-09',
      '2026-11-08',
      '2026-11-09',
      'no transaction date',
      'k3',
      JSON.stringify({ booking_date: '2026-11-09', value_date: '2026-11-08' }),
    );
    insert.run(
      '2026-11-09',
      null,
      '2026-11-09',
      'booking date only',
      'k4',
      JSON.stringify({ booking_date: '2026-11-09' }),
    );
    insert.run(null, null, '2026-11-10', 'no dates', 'k5', JSON.stringify({}));
    insert.run('2026-11-09', null, '2026-11-09', 'not json', 'k6', 'not json');

    apply(sqlite, migrations.slice(target, target + 1));

    expect(
      sqlite
        .prepare(
          'SELECT description, transaction_date, value_date, date, dedup_key FROM transactions ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        description: 'all three',
        transaction_date: '2026-11-07',
        value_date: '2026-11-08',
        date: '2026-11-07',
        dedup_key: 'k1',
      },
      {
        description: 'no value date',
        transaction_date: '2026-11-07',
        value_date: null,
        date: '2026-11-07',
        dedup_key: 'k2',
      },
      {
        description: 'no transaction date',
        transaction_date: null,
        value_date: '2026-11-08',
        date: '2026-11-08',
        dedup_key: 'k3',
      },
      {
        description: 'booking date only',
        transaction_date: null,
        value_date: null,
        date: '2026-11-09',
        dedup_key: 'k4',
      },
      {
        description: 'no dates',
        transaction_date: null,
        value_date: null,
        date: '2026-11-10',
        dedup_key: 'k5',
      },
      {
        description: 'not json',
        transaction_date: null,
        value_date: null,
        date: '2026-11-09',
        dedup_key: 'k6',
      },
    ]);
  });
});
