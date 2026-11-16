import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, subcategories, transactions } from '../src/db/schema';
import { FakeEnableBankingClient, testConfig } from './support';

/** An in-memory app with one connected account, for specs that call a module directly. */
export async function moduleApp() {
  const app: INestApplication = await createApp({
    config: testConfig,
    enableBanking: new FakeEnableBankingClient(),
    database: { inMemory: true },
    now: () => new Date('2026-12-15T12:00:00Z'),
  });
  await app.init();
  const db = app.get<AppDatabase>(DATABASE);
  db.insert(connections)
    .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-06-01') })
    .run();
  db.insert(accounts)
    .values({
      connectionId: 1,
      identificationHash: 'h1',
      uid: 'u1',
      name: 'Lönekonto',
      type: 'payment',
      currency: 'SEK',
    })
    .run();
  let keys = 0;
  const store = (
    amount: number,
    description: string,
    values: Partial<typeof transactions.$inferInsert> = {},
  ) =>
    db
      .insert(transactions)
      .values({
        accountId: 1,
        status: 'booked',
        amount,
        currency: 'SEK',
        date: '2026-12-01',
        description,
        dedupKey: `k${(keys += 1)}`,
        raw: '{}',
        fetchedAt: new Date('2026-12-01T12:00:00Z'),
        ...values,
      })
      .returning({ id: transactions.id })
      .get().id;
  const [first, second] = db.select({ id: subcategories.id }).from(subcategories).all();
  return { app, db, store, subcategory: first!.id, otherSubcategory: second!.id };
}
