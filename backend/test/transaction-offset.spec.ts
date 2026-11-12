import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  CategoriesResponse,
  OffsetCandidatesResponse,
  OverviewResponse,
  TransactionDetails,
  TransactionReviewResponse,
} from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

describe('kvitta a refund against its purchase', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let ids: Map<string, number>;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-12-15T12:00:00Z'),
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
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
    description: string,
    options: { subcategory?: string; confirmed?: boolean; status?: 'booked' | 'pending' } = {},
  ): number {
    counter += 1;
    return db
      .insert(transactions)
      .values({
        accountId: 1,
        status: options.status ?? 'booked',
        amount,
        currency: 'SEK',
        date,
        description,
        dedupKey: `k${counter}`,
        raw: '{}',
        fetchedAt: new Date('2026-12-10T12:00:00Z'),
        subcategoryId: options.subcategory === undefined ? null : ids.get(options.subcategory),
        categoryConfirmed: options.confirmed ?? false,
      })
      .returning({ id: transactions.id })
      .get().id;
  }

  const link = (refund: number, purchaseId: number | null) =>
    request(server()).put(`/api/transactions/${refund}/offset`).send({ purchaseId });
  const detail = async (id: number) =>
    (await request(server()).get(`/api/transactions/${id}`).expect(200)).body as TransactionDetails;
  const spending = async (month: string, subcategory = 'Kläder & skor') => {
    const body = (await request(server()).get('/api/overview').query({ month }).expect(200))
      .body as OverviewResponse;
    return {
      total: body.totals.spending,
      sub: body.categories.flatMap((c) => c.subcategories).find((s) => s.name === subcategory)
        ?.total,
    };
  };
  const review = async () =>
    (
      (await request(server()).get('/api/transactions/review').expect(200))
        .body as TransactionReviewResponse
    ).transactions.map((t) => t.id);
  const candidates = async (id: number, q?: string) =>
    (
      (
        await request(server())
          .get(`/api/transactions/${id}/offset-candidates`)
          .query(q === undefined ? {} : { q })
          .expect(200)
      ).body as OffsetCandidatesResponse
    ).transactions.map((t) => t.id);

  it('gives the refund the purchase’s subcategory as confirmed, and follows later changes', async () => {
    const purchase = store(-500, '2026-11-10', 'Zalando', {
      subcategory: 'Kläder & skor',
      confirmed: true,
    });
    const refund = store(500, '2026-12-05', 'Zalando');

    const body = (await link(refund, purchase).expect(200)).body as TransactionDetails;

    expect(body.category?.subcategory.name).toBe('Kläder & skor');
    expect(body.category?.confirmed).toBe(true);
    expect(body.offsets).toEqual({
      id: purchase,
      description: 'Zalando',
      amount: { amount: -500, currency: 'SEK' },
      date: '2026-11-10',
    });

    await request(server())
      .put(`/api/transactions/${purchase}/category`)
      .send({ subcategoryId: ids.get('Elektronik') })
      .expect(200);
    expect((await detail(refund)).category?.subcategory.name).toBe('Elektronik');
  });

  it('refuses to change a linked refund’s category directly', async () => {
    const purchase = store(-500, '2026-11-10', 'Zalando', {
      subcategory: 'Kläder & skor',
      confirmed: true,
    });
    const refund = store(500, '2026-12-05', 'Zalando');
    await link(refund, purchase).expect(200);

    await request(server())
      .put(`/api/transactions/${refund}/category`)
      .send({ subcategoryId: ids.get('Elektronik') })
      .expect(409);
  });

  it('nets a full refund to 0 in the purchase’s month, across a month boundary', async () => {
    const purchase = store(-500, '2026-11-28', 'Zalando', {
      subcategory: 'Kläder & skor',
      confirmed: true,
    });
    const refund = store(500, '2026-12-05', 'Zalando');
    expect(await spending('2026-12')).toEqual({ total: 0, sub: undefined });

    await link(refund, purchase).expect(200);

    expect(await spending('2026-11')).toEqual({ total: 0, sub: 0 });
    expect(await spending('2026-12')).toEqual({ total: 0, sub: undefined });
  });

  it('counts two partial refunds against one purchase, and shows the net amount', async () => {
    const purchase = store(-900, '2026-11-20', 'Restaurang Smak', {
      subcategory: 'Restaurang',
      confirmed: true,
    });
    const first = store(300, '2026-11-22', 'Swish Anna');
    const second = store(300, '2026-12-02', 'Swish Bo');
    await link(first, purchase).expect(200);
    await link(second, purchase).expect(200);

    expect(await spending('2026-11', 'Restaurang')).toEqual({ total: 300, sub: 300 });
    expect(await spending('2026-12', 'Restaurang')).toEqual({ total: 0, sub: undefined });

    const details = await detail(purchase);
    expect(details.refunds.map((r) => r.id)).toEqual([second, first]);
    expect(details.netAmount).toEqual({ amount: -300, currency: 'SEK' });
    expect((await detail(first)).netAmount).toBeNull();
  });

  it('lists the refunds in the purchase’s month under its subcategory', async () => {
    const purchase = store(-500, '2026-11-28', 'Zalando', {
      subcategory: 'Kläder & skor',
      confirmed: true,
    });
    const refund = store(200, '2026-12-05', 'Zalando');
    await link(refund, purchase).expect(200);

    const body = (
      await request(server())
        .get('/api/overview/transactions')
        .query({ month: '2026-11', subcategoryId: ids.get('Kläder & skor') })
        .expect(200)
    ).body as { transactions: { id: number }[] };
    expect(body.transactions.map((t) => t.id).sort()).toEqual([purchase, refund].sort());
  });

  it('restores the refund’s own month when the link is removed, keeping its category', async () => {
    const purchase = store(-500, '2026-11-28', 'Zalando', {
      subcategory: 'Kläder & skor',
      confirmed: true,
    });
    const refund = store(500, '2026-12-05', 'Zalando');
    await link(refund, purchase).expect(200);

    const body = (await link(refund, null).expect(200)).body as TransactionDetails;

    expect(body.offsets).toBeNull();
    expect(body.category?.subcategory.name).toBe('Kläder & skor');
    expect(body.category?.confirmed).toBe(true);
    expect(await spending('2026-11')).toEqual({ total: 500, sub: 500 });
    expect(await spending('2026-12')).toEqual({ total: -500, sub: -500 });
    expect((await detail(purchase)).refunds).toEqual([]);
  });

  it('hides a linked pair from Att granska once the purchase has a category', async () => {
    const guessed = store(-500, '2026-11-10', 'Zalando', { subcategory: 'Kläder & skor' });
    const refund = store(500, '2026-12-05', 'Zalando');
    expect(await review()).toEqual([refund, guessed]);

    await link(refund, guessed).expect(200);

    expect(await review()).toEqual([]);
  });

  it('keeps only the purchase in Att granska while it has no category', async () => {
    const purchase = store(-500, '2026-11-10', 'Zalando');
    const refund = store(500, '2026-12-05', 'Zalando');

    await link(refund, purchase).expect(200);

    expect(await review()).toEqual([purchase]);
    await request(server())
      .put(`/api/transactions/${purchase}/category`)
      .send({ subcategoryId: ids.get('Kläder & skor') })
      .expect(200);
    expect(await review()).toEqual([]);
  });

  it('only links a booked refund to a booked purchase of the right sign', async () => {
    const purchase = store(-500, '2026-11-10', 'Zalando', { subcategory: 'Kläder & skor' });
    const other = store(-100, '2026-11-11', 'Kiosk');
    const refund = store(500, '2026-12-05', 'Zalando');
    const pending = store(50, '2026-12-05', 'Zalando', { status: 'pending' });
    await link(refund, purchase).expect(200);

    await link(purchase, other).expect(400); // money out is not a refund
    await link(pending, purchase).expect(400);
    await link(refund, refund).expect(400); // a refund is not a purchase
    await link(other, 9999).expect(400);
    await link(9999, purchase).expect(404);
  });

  describe('suggestions', () => {
    it('finds the returned item’s purchase, best match first', async () => {
      const refund = store(300, '2026-12-05', 'Zalando 4411');
      const near = store(-310, '2026-11-30', 'ZALANDO');
      const exact = store(-300, '2026-10-20', 'Zalando');
      const similar = store(-300, '2026-12-01', 'Zalando Payments');
      store(-300, '2026-12-01', 'Kiosken'); // other merchant
      store(-200, '2026-12-01', 'Zalando'); // less than the refund
      store(-300, '2026-07-01', 'Zalando'); // outside the window
      store(-300, '2026-12-06', 'Zalando'); // after the refund

      expect(await candidates(refund)).toEqual([exact, near, similar]);
    });

    it('does not suggest purchases that are refunds themselves or for money out', async () => {
      const refund = store(300, '2026-12-05', 'Zalando');
      store(100, '2026-11-30', 'Zalando');
      expect(await candidates(refund)).toEqual([]);
      const purchase = store(-300, '2026-11-30', 'Zalando');
      expect(await candidates(purchase)).toEqual([]);
    });

    it('searches any purchase by description when given a text, newest first', async () => {
      const refund = store(300, '2026-12-05', 'Swish Anna');
      const old = store(-50, '2025-01-02', 'Restaurang Smak');
      const recent = store(-900, '2026-11-20', 'RESTAURANG Smak AB');
      store(-900, '2026-11-20', 'Kiosken');

      expect(await candidates(refund, 'restaurang')).toEqual([recent, old]);
    });
  });
});
