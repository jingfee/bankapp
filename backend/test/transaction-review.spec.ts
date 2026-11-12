import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { CategoriesResponse, TransactionReviewResponse } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

describe('transactions to review', () => {
  let app: INestApplication;
  let db: AppDatabase;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
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

  const server = () => app.getHttpServer();

  let counter = 0;
  /** Stores an unconfirmed transaction and returns its id; `subcategoryId` makes it a guess. */
  function store(description: string, date: string, subcategoryId: number | null = null): number {
    counter += 1;
    return db
      .insert(transactions)
      .values({
        accountId: 1,
        status: 'booked',
        amount: -10,
        currency: 'SEK',
        date,
        description,
        dedupKey: `k${counter}`,
        raw: '{}',
        fetchedAt: new Date('2026-11-10T12:00:00Z'),
        subcategoryId,
      })
      .returning({ id: transactions.id })
      .get().id;
  }

  async function livsmedel(): Promise<number> {
    const body = (await request(server()).get('/api/categories').expect(200))
      .body as CategoriesResponse;
    const found = body.categories
      .flatMap((c) => c.subcategories)
      .find((s) => s.name === 'Livsmedel');
    if (!found) throw new Error('No Livsmedel');
    return found.id;
  }

  const review = async () =>
    (await request(server()).get('/api/transactions/review').expect(200))
      .body as TransactionReviewResponse;

  it('is empty when there are no transactions', async () => {
    expect(await review()).toEqual({ count: 0, transactions: [] });
    expect(
      (await request(server()).get('/api/transactions/review/count').expect(200)).body,
    ).toEqual({ count: 0 });
  });

  it('lists uncategorised transactions newest first, and counts them', async () => {
    const older = store('Xyzzy A', '2026-11-01');
    const newer = store('Xyzzy B', '2026-11-05');
    const sameDay = store('Xyzzy C', '2026-11-05');

    const { count, transactions: listed } = await review();

    expect(count).toBe(3);
    expect(listed.map((t) => t.id)).toEqual([sameDay, newer, older]);
    expect(listed.every((t) => t.category === null)).toBe(true);
    expect((await request(server()).get('/api/transactions/review/count')).body).toEqual({
      count: 3,
    });
  });

  it('includes guessed transactions, with their guess', async () => {
    store('ICA Nara Hornstull', '2026-11-08', await livsmedel());

    const { count, transactions: listed } = await review();

    expect(count).toBe(1);
    expect(listed[0]?.category?.confirmed).toBe(false);
    expect(listed[0]?.category?.subcategory.name).toBe('Livsmedel');
  });

  it('drops a transaction once the owner has confirmed it, or removed its category', async () => {
    const id = await livsmedel();
    const confirmed = store('ICA Nara Hornstull', '2026-11-08', id);
    const removed = store('Xyzzy A', '2026-11-07');
    const picked = store('Xyzzy B', '2026-11-06');
    store('Xyzzy C', '2026-11-05');
    await request(server())
      .put(`/api/transactions/${confirmed}/category`)
      .send({ subcategoryId: id });
    await request(server())
      .put(`/api/transactions/${removed}/category`)
      .send({ subcategoryId: null });
    await request(server()).put(`/api/transactions/${picked}/category`).send({ subcategoryId: id });

    const { count, transactions: listed } = await review();

    expect(count).toBe(1);
    expect(listed.map((t) => t.description)).toEqual(['Xyzzy C']);
  });
});
