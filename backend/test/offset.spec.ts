import type { INestApplication } from '@nestjs/common';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { NoSuchPurchase, NoSuchTransaction, NotLinkable } from '../src/domain-errors';
import { Offset } from '../src/transactions/offset';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

describe('the offset module', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let offset: Offset;
  let keys = 0;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
    offset = app.get(Offset);
    db.insert(connections)
      .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-01-01') })
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
  });

  afterEach(() => app.close());

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

  it('can link every purchase it offers as a candidate', () => {
    const refund = store(100, 'Zalando', { date: '2026-12-10' });
    const earlier = store(-100, 'Zalando');
    store(-250, 'Zalando kläder');
    store(-100, 'Pending Zalando', { status: 'pending' });
    store(-100, 'Zalando in euro', { currency: 'EUR' });
    store(-100, 'Zalando refunded', { offsetsTransactionId: earlier });
    store(-100, 'Zalando later', { date: '2026-12-20' });

    const candidates = offset.candidates(refund).transactions;
    expect(candidates.map((t) => t.description)).toEqual(['Zalando', 'Zalando kläder']);
    for (const candidate of candidates) {
      expect(() => offset.link(refund, candidate.id)).not.toThrow();
    }
    // A search offers only what can be linked as well.
    const found = offset.candidates(refund, 'zalando').transactions;
    expect(found.length).toBeGreaterThan(0);
    for (const candidate of found) {
      expect(() => offset.link(refund, candidate.id)).not.toThrow();
    }
  });

  it('offers no candidate to a refund that is not booked', () => {
    const refund = store(100, 'Zalando', { status: 'pending' });
    store(-100, 'Zalando');
    expect(offset.candidates(refund).transactions).toEqual([]);
    expect(offset.candidates(refund, 'zalando').transactions).toEqual([]);
    expect(() => offset.link(refund, 2)).toThrow(NotLinkable);
  });

  it('offers no candidate to a transaction that is itself a purchase with refunds', () => {
    const purchase = store(-100, 'Zalando');
    store(60, 'Zalando refund', { offsetsTransactionId: purchase });
    store(-50, 'Other');
    expect(offset.candidates(purchase).transactions).toEqual([]);
    expect(offset.candidates(1, 'other').transactions).toEqual([]);
  });

  it('rejects what does not exist', () => {
    const refund = store(100, 'Zalando');
    expect(() => offset.link(999, null)).toThrow(NoSuchTransaction);
    expect(() => offset.link(refund, 999)).toThrow(NoSuchPurchase);
    expect(() => offset.candidates(999)).toThrow(NoSuchTransaction);
  });
});
