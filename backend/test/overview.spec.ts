import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  CategoriesResponse,
  OverviewResponse,
  OverviewTransactionsResponse,
} from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

describe('overview of a month', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let ids: Map<string, number>;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-11-15T12:00:00Z'),
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
    const body = (await request(server()).get('/api/categories').expect(200))
      .body as CategoriesResponse;
    ids = new Map(body.categories.flatMap((c) => c.subcategories).map((s) => [s.name, s.id]));
  });

  afterEach(() => app.close());

  const server = () => app.getHttpServer();

  let counter = 0;
  function store(
    amount: number,
    date: string,
    subcategory: string | null,
    status: 'booked' | 'pending' = 'booked',
  ): number {
    counter += 1;
    const subcategoryId = subcategory === null ? null : ids.get(subcategory);
    if (subcategoryId === undefined) throw new Error(`No ${subcategory}`);
    return db
      .insert(transactions)
      .values({
        accountId: 1,
        status,
        amount,
        currency: 'SEK',
        date,
        description: `Köp ${counter}`,
        dedupKey: `k${counter}`,
        raw: '{}',
        fetchedAt: new Date('2026-11-10T12:00:00Z'),
        subcategoryId,
      })
      .returning({ id: transactions.id })
      .get().id;
  }

  const overview = async (month?: string) =>
    (
      await request(server())
        .get('/api/overview')
        .query(month === undefined ? {} : { month })
        .expect(200)
    ).body as OverviewResponse;

  it('is all zero for a month without transactions', async () => {
    const body = await overview('2026-11');
    expect(body).toEqual({
      month: '2026-11',
      totals: { income: 0, spending: 0, net: 0 },
      previous: { income: 0, spending: 0, net: 0 },
      categories: [],
      uncategorised: 0,
    });
  });

  it('defaults to the current month', async () => {
    expect((await overview()).month).toBe('2026-11');
  });

  it('rejects a month that is not YYYY-MM', async () => {
    for (const month of ['2026-13', '2026-1', 'november', '2026-11-01']) {
      await request(server()).get('/api/overview').query({ month }).expect(400);
    }
  });

  it('counts income and spending by the category kind, not the sign', async () => {
    store(30000, '2026-11-25', 'Lön');
    store(-200, '2026-11-03', 'Livsmedel');
    store(-100, '2026-11-04', 'Restaurang');
    store(50, '2026-11-05', 'Livsmedel'); // a refund reduces spending
    const { totals } = await overview('2026-11');
    expect(totals).toEqual({ income: 30000, spending: 250, net: 29750 });
  });

  it('leaves transfers out of every total and the breakdown', async () => {
    store(-5000, '2026-11-02', 'Kortbetalning');
    store(2000, '2026-11-02', 'Mellan egna konton');
    store(-100, '2026-11-03', 'Livsmedel');
    const body = await overview('2026-11');
    expect(body.totals).toEqual({ income: 0, spending: 100, net: -100 });
    expect(body.categories.map((c) => c.name)).toEqual(['Mat & Dryck']);
  });

  it('includes pending transactions and guessed categories', async () => {
    store(-80, '2026-11-06', 'Livsmedel', 'pending');
    expect((await overview('2026-11')).totals.spending).toBe(80);
  });

  it('assigns transactions to a month by their date', async () => {
    store(-100, '2026-10-31', 'Livsmedel');
    store(-200, '2026-11-01', 'Livsmedel');
    store(-300, '2026-11-30', 'Livsmedel');
    store(-400, '2026-12-01', 'Livsmedel');
    const body = await overview('2026-11');
    expect(body.totals.spending).toBe(500);
    expect(body.previous.spending).toBe(100);
  });

  it('compares with the previous month, across a year boundary too', async () => {
    store(-100, '2025-12-10', 'Livsmedel');
    store(1000, '2025-12-25', 'Lön');
    store(-40, '2026-01-10', 'Livsmedel');
    const body = await overview('2026-01');
    expect(body.previous).toEqual({ income: 1000, spending: 100, net: 900 });
    expect(body.totals).toEqual({ income: 0, spending: 40, net: -40 });
  });

  it('counts uncategorised transactions outside the totals', async () => {
    store(-999, '2026-11-02', null);
    store(-1, '2026-11-03', null, 'pending');
    store(-999, '2026-10-02', null);
    store(-100, '2026-11-03', 'Livsmedel');
    const body = await overview('2026-11');
    expect(body.uncategorised).toBe(2);
    expect(body.totals.spending).toBe(100);
  });

  it('breaks spending down by category and subcategory, largest first', async () => {
    store(-100, '2026-11-02', 'Restaurang');
    store(-300, '2026-11-03', 'Livsmedel');
    store(-50, '2026-11-04', 'Livsmedel');
    store(-700, '2026-11-05', 'Hyra & avgift');
    store(30000, '2026-11-25', 'Lön');
    const { categories } = await overview('2026-11');
    expect(categories.map((c) => [c.name, c.kind, c.total])).toEqual([
      ['Inkomst', 'income', 30000],
      ['Boende & Hushåll', 'expense', 700],
      ['Mat & Dryck', 'expense', 450],
    ]);
    const food = categories.find((c) => c.name === 'Mat & Dryck');
    expect(food?.subcategories.map((s) => [s.name, s.total])).toEqual([
      ['Livsmedel', 350],
      ['Restaurang', 100],
    ]);
    expect(food?.colour).toEqual(expect.any(String));
  });

  it('lists the transactions of one subcategory in one month, newest first', async () => {
    const early = store(-10, '2026-11-02', 'Livsmedel');
    const late = store(-20, '2026-11-20', 'Livsmedel');
    store(-30, '2026-10-20', 'Livsmedel');
    store(-40, '2026-11-21', 'Restaurang');
    const body = (
      await request(server())
        .get('/api/overview/transactions')
        .query({ month: '2026-11', subcategoryId: ids.get('Livsmedel') })
        .expect(200)
    ).body as OverviewTransactionsResponse;
    expect(body.transactions.map((t) => t.id)).toEqual([late, early]);
  });

  it('rejects a transactions request without a valid month and subcategory', async () => {
    await request(server()).get('/api/overview/transactions').expect(400);
    await request(server())
      .get('/api/overview/transactions')
      .query({ month: '2026-11', subcategoryId: 'x' })
      .expect(400);
  });
});
