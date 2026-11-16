import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  CategoriesResponse,
  OverviewResponse,
  OverviewTransactionsResponse,
} from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig, api } from './support';

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
    const body = (await api(app).get('/api/categories').expect(200)).body as CategoriesResponse;
    ids = new Map(body.categories.flatMap((c) => c.subcategories).map((s) => [s.name, s.id]));
  });

  afterEach(() => app.close());

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
      await api(app)
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
      spendingByDay: { current: Array(30).fill(0), previous: Array(31).fill(0) },
    });
  });

  it('defaults to the current month', async () => {
    expect((await overview()).month).toBe('2026-11');
  });

  it('rejects a month that is not YYYY-MM', async () => {
    for (const month of ['2026-13', '2026-1', 'november', '2026-11-01']) {
      await api(app).get('/api/overview').query({ month }).expect(400);
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

  describe('spending by day', () => {
    it('accumulates spending day by day for the month and the month before', async () => {
      store(-100, '2026-10-02', 'Livsmedel');
      store(-50, '2026-10-31', 'Restaurang');
      store(-200, '2026-11-01', 'Livsmedel');
      store(-30, '2026-11-03', 'Livsmedel');
      store(-20, '2026-11-03', 'Restaurang');
      const { spendingByDay } = await overview('2026-11');
      expect(spendingByDay.current).toHaveLength(30);
      expect(spendingByDay.current.slice(0, 4)).toEqual([200, 200, 250, 250]);
      expect(spendingByDay.current[29]).toBe(250);
      expect(spendingByDay.previous).toHaveLength(31);
      expect(spendingByDay.previous.slice(0, 3)).toEqual([0, 100, 100]);
      expect(spendingByDay.previous[30]).toBe(150);
    });

    it('ends on the month totals and leaves income and transfers out', async () => {
      store(30000, '2026-11-25', 'Lön');
      store(-5000, '2026-11-02', 'Kortbetalning');
      store(-100, '2026-11-03', 'Livsmedel');
      store(40, '2026-11-05', 'Livsmedel');
      const { spendingByDay, totals } = await overview('2026-11');
      expect(spendingByDay.current.at(-1)).toBe(totals.spending);
      expect(spendingByDay.current.slice(0, 5)).toEqual([0, 0, 100, 100, 60]);
    });

    it('counts a kvittad refund on its purchase day', async () => {
      const purchase = store(-100, '2026-10-20', 'Livsmedel');
      const refund = store(30, '2026-11-05', 'Livsmedel');
      db.update(transactions)
        .set({ offsetsTransactionId: purchase })
        .where(eq(transactions.id, refund))
        .run();
      const { spendingByDay } = await overview('2026-11');
      expect(spendingByDay.current.at(-1)).toBe(0);
      expect(spendingByDay.previous[19]).toBe(70);
    });

    it('weights each amount by its share in Min andel', async () => {
      store(-100, '2026-11-03', 'Livsmedel');
      const body = (
        await api(app).get('/api/overview').query({ month: '2026-11', view: 'mine' }).expect(200)
      ).body as OverviewResponse;
      expect(body.spendingByDay.current.at(-1)).toBe(body.totals.spending);
    });

    it('follows the length of February in a leap year', async () => {
      const { spendingByDay } = await overview('2028-02');
      expect(spendingByDay.current).toHaveLength(29);
      expect(spendingByDay.previous).toHaveLength(31);
    });
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
      await api(app)
        .get('/api/overview/transactions')
        .query({ month: '2026-11', subcategoryId: ids.get('Livsmedel') })
        .expect(200)
    ).body as OverviewTransactionsResponse;
    expect(body.transactions.map((t) => t.id)).toEqual([late, early]);
  });

  it('rejects a transactions request without a valid month and subcategory', async () => {
    await api(app).get('/api/overview/transactions').expect(400);
    await api(app)
      .get('/api/overview/transactions')
      .query({ month: '2026-11', subcategoryId: 'x' })
      .expect(400);
  });

  describe('Min andel and Hela beloppet', () => {
    beforeEach(() => {
      db.insert(accounts)
        .values({
          connectionId: 1,
          identificationHash: 'h2',
          uid: 'u2',
          name: 'Coop Mastercard',
          type: 'card',
          currency: 'SEK',
        })
        .run();
    });

    const storeOn = (
      accountId: number,
      amount: number,
      date: string,
      subcategory: string,
      values: Partial<typeof transactions.$inferInsert> = {},
    ): number => {
      const id = store(amount, date, subcategory);
      db.update(transactions)
        .set({ accountId, ...values })
        .where(eq(transactions.id, id))
        .run();
      return id;
    };

    const view = async (month: string, which?: string) =>
      (
        await api(app)
          .get('/api/overview')
          .query(which === undefined ? { month } : { month, view: which })
          .expect(200)
      ).body as OverviewResponse;

    const setAccountShare = (id: number, share: string) =>
      api(app).put(`/api/accounts/${id}/share`).send({ share }).expect(200);

    it('counts a 50/50 card purchase of 200 kr as 100 kr in Min andel and 200 kr in Hela beloppet', async () => {
      await setAccountShare(2, 'half');
      storeOn(2, -200, '2026-11-03', 'Livsmedel');
      expect((await view('2026-11', 'mine')).totals.spending).toBe(100);
      expect((await view('2026-11', 'full')).totals.spending).toBe(200);
    });

    it('shows Hela beloppet when no view is given', async () => {
      await setAccountShare(2, 'half');
      storeOn(2, -200, '2026-11-03', 'Livsmedel');
      expect((await view('2026-11')).totals.spending).toBe(200);
    });

    it('weights income, spending, net, the bars and the previous month by share, from every source', async () => {
      await setAccountShare(2, 'half');
      await api(app)
        .put(`/api/subcategories/${ids.get('Restaurang')}/share`)
        .send({ share: 'partner' })
        .expect(200);
      storeOn(1, 30000, '2026-11-25', 'Lön');
      storeOn(2, -200, '2026-11-03', 'Livsmedel'); // account: 50%
      storeOn(1, -100, '2026-11-04', 'Restaurang'); // subcategory: 0%
      storeOn(1, -80, '2026-11-05', 'Livsmedel', { share: 'half' }); // own: 50%
      storeOn(1, -60, '2026-11-06', 'Livsmedel'); // default: 100%
      storeOn(2, -400, '2026-10-03', 'Livsmedel'); // previous month: 50%

      const mine = await view('2026-11', 'mine');
      expect(mine.totals).toEqual({ income: 30000, spending: 200, net: 29800 });
      expect(mine.previous.spending).toBe(200);
      const food = mine.categories.find((c) => c.name === 'Mat & Dryck');
      expect(food?.total).toBe(200);
      expect(food?.subcategories.map((s) => [s.name, s.total])).toEqual([
        ['Livsmedel', 200],
        ['Restaurang', 0],
      ]);

      const full = await view('2026-11', 'full');
      expect(full.totals).toEqual({ income: 30000, spending: 440, net: 29560 });
      expect(full.previous.spending).toBe(400);
    });

    it('nets a fully refunded shared purchase to 0 kr in both views, in the purchase’s month', async () => {
      await setAccountShare(2, 'half');
      const purchase = storeOn(2, -200, '2026-10-30', 'Livsmedel');
      const refund = storeOn(2, 200, '2026-11-05', 'Livsmedel');
      await api(app)
        .put(`/api/transactions/${refund}/offset`)
        .send({ purchaseId: purchase })
        .expect(200);
      for (const which of ['mine', 'full']) {
        expect((await view('2026-10', which)).totals.spending).toBe(0);
        expect((await view('2026-11', which)).totals.spending).toBe(0);
        expect((await view('2026-12', which)).previous.spending).toBe(0);
      }
    });

    it('weights a partial refund on a Jag account by its purchase’s share', async () => {
      await setAccountShare(2, 'half');
      const purchase = storeOn(2, -200, '2026-10-30', 'Livsmedel');
      const refund = storeOn(1, 50, '2026-11-05', 'Livsmedel');
      await api(app)
        .put(`/api/transactions/${refund}/offset`)
        .send({ purchaseId: purchase })
        .expect(200);
      expect((await view('2026-10', 'mine')).totals.spending).toBe(75);
      expect((await view('2026-10', 'full')).totals.spending).toBe(150);
      expect((await view('2026-11', 'mine')).totals.spending).toBe(0);
    });

    it('leaves transfers, including Avräkning, out of both views', async () => {
      await setAccountShare(2, 'half');
      storeOn(1, 1000, '2026-11-02', 'Avräkning delade utgifter');
      storeOn(2, -5000, '2026-11-02', 'Kortbetalning');
      storeOn(2, -200, '2026-11-03', 'Livsmedel');
      for (const which of ['mine', 'full']) {
        const body = await view('2026-11', which);
        expect(body.totals.income).toBe(0);
        expect(body.categories.map((c) => c.name)).toEqual(['Mat & Dryck']);
      }
    });

    it('keeps real amounts in the drill-down, with each transaction’s share', async () => {
      await setAccountShare(2, 'half');
      const id = storeOn(2, -200, '2026-11-03', 'Livsmedel');
      const body = (
        await api(app)
          .get('/api/overview/transactions')
          .query({ month: '2026-11', subcategoryId: ids.get('Livsmedel') })
          .expect(200)
      ).body as OverviewTransactionsResponse;
      expect(body.transactions).toHaveLength(1);
      expect(body.transactions[0]).toMatchObject({
        id,
        amount: { amount: -200 },
        share: { option: 'half', percent: 50 },
      });
    });

    it('rejects an unknown view', async () => {
      await api(app).get('/api/overview').query({ view: 'x' }).expect(400);
    });
  });
});
