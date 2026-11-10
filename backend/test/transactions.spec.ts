import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { TransactionsResponse } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

type Row = typeof transactions.$inferInsert;

describe('GET /api/transactions', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let nextId = 1;

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
      .values([
        {
          connectionId: 1,
          identificationHash: 'h1',
          uid: 'u1',
          name: 'Lönekonto',
          type: 'payment',
          currency: 'SEK',
        },
        {
          connectionId: 1,
          identificationHash: 'h2',
          uid: 'u2',
          name: 'Sparkonto',
          type: 'savings',
          currency: 'SEK',
        },
      ])
      .run();
    nextId = 1;
  });

  afterEach(() => app.close());

  function add(overrides: Partial<Row> & { date: string }, accountId = 1): void {
    const id = nextId++;
    db.insert(transactions)
      .values({
        accountId,
        status: 'booked',
        amount: -10,
        currency: 'SEK',
        bookingDate: overrides.date,
        valueDate: overrides.date,
        description: `T${id}`,
        entryReference: null,
        dedupKey: `k${id}`,
        raw: '{}',
        fetchedAt: new Date('2026-11-10T12:00:00Z'),
        ...overrides,
      })
      .run();
  }

  const get = (query = '') => request(app.getHttpServer()).get(`/api/transactions${query}`);
  const list = async (query = ''): Promise<TransactionsResponse> =>
    (await get(query).expect(200)).body;

  it('lists the transactions of every account newest first, each with its account', async () => {
    add({ date: '2026-11-08', description: 'Old', amount: -5 });
    add({ date: '2026-11-10', description: 'Newest', amount: 100 });
    add({ date: '2026-11-09', description: 'Middle', status: 'pending' }, 2);

    const body = await list();

    expect(
      body.transactions.map(({ date, description, status, amount, account }) => ({
        date,
        description,
        status,
        amount,
        account,
      })),
    ).toEqual([
      {
        date: '2026-11-10',
        description: 'Newest',
        status: 'booked',
        amount: { amount: 100, currency: 'SEK' },
        account: { id: 1, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
      },
      {
        date: '2026-11-09',
        description: 'Middle',
        status: 'pending',
        amount: { amount: -10, currency: 'SEK' },
        account: { id: 2, name: 'Sparkonto', bank: 'Swedbank', type: 'savings' },
      },
      {
        date: '2026-11-08',
        description: 'Old',
        status: 'booked',
        amount: { amount: -5, currency: 'SEK' },
        account: { id: 1, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
      },
    ]);
    expect(body.nextCursor).toBeNull();
  });

  it('does not expose the raw bank response', async () => {
    add({ date: '2026-11-10', raw: '{"secret":1}' });

    expect(JSON.stringify(await list())).not.toContain('secret');
  });

  it('is paginated, with every transaction on exactly one page', async () => {
    for (let day = 1; day <= 30; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`;
      add({ date });
      add({ date });
    }

    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const body: TransactionsResponse = await list(cursor ? `?before=${cursor}` : '');
      seen.push(...body.transactions.map((t) => t.id));
      cursor = body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(2);
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    // Newest first: by date, and within a day the later-stored first.
    expect(seen.slice(0, 2)).toEqual([60, 59]);
    expect(seen.at(-1)).toBe(1);
  });

  it('returns an empty list when there are no transactions', async () => {
    expect(await list()).toEqual({ transactions: [], nextCursor: null });
  });

  it('answers 400 for a bad cursor', async () => {
    await get('?before=nonsense').expect(400);
  });
});
