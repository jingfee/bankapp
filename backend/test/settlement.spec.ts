import type { INestApplication } from '@nestjs/common';
import type {
  CategoriesResponse,
  SetHouseholdRatioRequest,
  SettlementResponse,
  ShareOption,
} from '@bankapp/shared';
import { asc, eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, settlementMonths, transactions } from '../src/db/schema';
import { FakeEnableBankingClient, testConfig, api } from './support';

describe('the settlement balance', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let subcategoryIds: Map<string, number>;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-11-15T12:00:00'),
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
    db.insert(connections)
      .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-06-01') })
      .run();
    // Account 1 is Jag, account 2 is 50/50.
    db.insert(accounts)
      .values(
        ['Lönekonto', 'Coop Mastercard'].map((name, i) => ({
          connectionId: 1,
          identificationHash: `h${i}`,
          uid: `u${i}`,
          name,
          type: i === 0 ? ('payment' as const) : ('card' as const),
          currency: 'SEK',
          share: i === 0 ? null : ('half' as const),
        })),
      )
      .run();
    const body = (await api(app).get('/api/categories').expect(200)).body as CategoriesResponse;
    subcategoryIds = new Map(
      body.categories.flatMap((c) => c.subcategories).map((s) => [s.name, s.id]),
    );
  });

  afterEach(() => app.close());

  let counter = 0;
  function store(
    accountId: number,
    amount: number,
    date: string,
    values: Partial<typeof transactions.$inferInsert> = {},
  ): number {
    counter += 1;
    return db
      .insert(transactions)
      .values({
        accountId,
        status: 'booked',
        amount,
        currency: 'SEK',
        date,
        description: `Köp ${counter}`,
        dedupKey: `k${counter}`,
        raw: '{}',
        fetchedAt: new Date('2026-11-10T12:00:00Z'),
        ...values,
      })
      .returning({ id: transactions.id })
      .get().id;
  }

  const inCategory = (name: string) => ({
    subcategoryId: subcategoryIds.get(name)!,
    categoryConfirmed: true,
  });
  const settle = (amount: number, date: string, values = {}) =>
    store(1, amount, date, { ...inCategory('Avräkning delade utgifter'), ...values });

  const setBalance = (amount: number, asOf?: string) =>
    api(app).post('/api/settlement/balance-settings').send({ amount, asOf });
  const get = async () =>
    (await api(app).get('/api/settlement').expect(200)).body as SettlementResponse;
  const balance = async () => (await get()).balance;

  it('rejects a setting without a number or with a bad day', async () => {
    await setBalance('lots' as unknown as number).expect(400);
    await setBalance(100, '15 nov').expect(400);
    await setBalance(100, '2026-02-30').expect(400);
    await setBalance(100, '2026-11-16').expect(400);
  });

  it('sets a balance as of today by default', async () => {
    const body = (await setBalance(4312).expect(201)).body as SettlementResponse;
    expect(body.balance).toBe(4312);
    expect(body.balanceSettings).toEqual([{ amount: 4312, asOf: '2026-11-15' }]);
  });

  it('counts uncategorised, guessed and pending transactions and their changes', async () => {
    await setBalance(0, '2026-11-01');
    store(2, -100, '2026-11-02'); // uncategorised
    store(2, -100, '2026-11-02', { subcategoryId: subcategoryIds.get('Livsmedel')! }); // guessed
    const pending = store(2, -300, '2026-11-03', { status: 'pending' });
    expect(await balance()).toBe(250);
    db.update(transactions).set({ amount: -500 }).where(eq(transactions.id, pending)).run();
    expect(await balance()).toBe(350);
    db.delete(transactions).where(eq(transactions.id, pending)).run();
    expect(await balance()).toBe(100);
  });

  it('leaves out transactions of hidden accounts', async () => {
    await setBalance(0, '2026-11-01');
    db.update(accounts).set({ hidden: true }).where(eq(accounts.id, 2)).run();
    store(2, -1000, '2026-11-02');
    expect(await balance()).toBe(0);
  });

  it('applies the share chosen for the transaction, including Hushåll and Partner', async () => {
    await api(app)
      .put('/api/household-ratio')
      .send({ entries: [{ from: '2026-01-01', percent: 60 }] } satisfies SetHouseholdRatioRequest)
      .expect(200);
    await setBalance(0, '2026-11-01');
    const shares: ShareOption[] = ['household', 'partner'];
    for (const share of shares) store(1, -1000, '2026-11-02', { share });
    expect(await balance()).toBe(400 + 1000);
  });

  it('counts an account’s transactions only from the day it was first connected', async () => {
    await setBalance(0, '2026-11-01');
    db.update(accounts).set({ connectedOn: '2026-11-10' }).where(eq(accounts.id, 2)).run();
    store(2, -1000, '2026-11-05');
    store(2, -1000, '2026-11-10');
    expect(await balance()).toBe(500);
  });

  it('gives each item its subcategory’s icon and category colour, null when uncategorised', async () => {
    await setBalance(0, '2026-11-01');
    store(2, -100, '2026-11-02', inCategory('Livsmedel'));
    store(2, -100, '2026-11-03');
    const { periods } = await get();
    const categories = (await api(app).get('/api/categories').expect(200))
      .body as CategoriesResponse;
    const category = categories.categories.find((c) =>
      c.subcategories.some((s) => s.name === 'Livsmedel'),
    )!;
    const sub = category.subcategories.find((s) => s.name === 'Livsmedel')!;
    expect(periods[0]?.items.map((i) => [i.icon, i.colour])).toEqual([
      [sub.icon, category.colour],
      [null, null],
    ]);
  });

  describe('settlement periods', () => {
    const close = (closedThrough: string, nextMonth: string) =>
      api(app).post('/api/settlement/close').send({ closedThrough, nextMonth });
    const undo = () => api(app).post('/api/settlement/undo-close');
    const periodRows = () =>
      db
        .select({ month: settlementMonths.month, closedThrough: settlementMonths.closedThrough })
        .from(settlementMonths)
        .orderBy(asc(settlementMonths.month))
        .all();

    it('never write on a read, so an empty database stores no period', async () => {
      await api(app).get('/api/settlement').expect(200);
      await api(app).get('/api/settlement/balance').expect(200);
      expect(periodRows()).toEqual([]);
      await setBalance(100, '2026-10-01');
      await get();
      expect(periodRows()).toEqual([]);
    });

    it('store the virtual open period with the first close', async () => {
      await setBalance(100, '2026-10-01');
      await close('2026-11-10', '2026-12').expect(201);
      expect(periodRows()).toEqual([
        { month: '2026-11', closedThrough: '2026-11-10' },
        { month: '2026-12', closedThrough: null },
      ]);
    });

    it('store a close, and an undo removes it', async () => {
      await setBalance(100, '2026-10-01');
      settle(30, '2026-11-02');
      await close('2026-11-10', '2026-12').expect(201);
      expect((await get()).periods.map((p) => [p.month, p.closedThrough])).toEqual([
        ['2026-12', null],
        ['2026-11', '2026-11-10'],
      ]);
      await undo().expect(201);
      expect(periodRows()).toEqual([{ month: '2026-11', closedThrough: null }]);
      expect((await get()).balance).toBe(70);
    });
  });
});
