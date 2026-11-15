import type { INestApplication } from '@nestjs/common';
import type {
  CategoriesResponse,
  HouseholdRatioResponse,
  SettlementResponse,
  ShareOption,
} from '@bankapp/shared';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, transactions } from '../src/db/schema';
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

  it('has no balance until the first balance setting', async () => {
    store(2, -1000, '2026-11-10');
    expect(await get()).toEqual({ balance: null, periods: [], balanceSettings: [] });
    expect((await api(app).get('/api/settlement/balance').expect(200)).body).toEqual({
      balance: null,
    });
  });

  it('rejects a setting without a number or with a bad day', async () => {
    await setBalance('lots' as unknown as number).expect(400);
    await setBalance(100, '15 nov').expect(400);
    await setBalance(100, '2026-02-30').expect(400);
    await setBalance(100, '2026-11-16').expect(400);
  });

  it('lets a setting made later win even when its day is earlier', async () => {
    await setBalance(5000, '2026-11-15');
    await setBalance(4000, '2026-11-10');
    store(2, -1000, '2026-11-12');
    const body = await get();
    expect(body.balance).toBe(4500);
    expect(body.balanceSettings.map((s) => s.amount)).toEqual([4000, 5000]);
  });

  it('sets a balance as of today by default', async () => {
    const body = (await setBalance(4312).expect(201)).body as SettlementResponse;
    expect(body.balance).toBe(4312);
    expect(body.balanceSettings).toEqual([{ amount: 4312, asOf: '2026-11-15' }]);
  });

  it('raises the balance by the partner’s part of a 50/50 purchase, not by the card payment', async () => {
    await setBalance(0, '2026-11-01');
    store(2, -1000, '2026-11-10');
    store(1, 1000, '2026-11-12', inCategory('Kortbetalning')); // the invoice, a transfer
    store(2, 1000, '2026-11-12', inCategory('Kortbetalning'));
    expect(await balance()).toBe(500);
  });

  it('counts only transactions dated on or after the setting’s day', async () => {
    store(2, -1000, '2026-10-31');
    await setBalance(100, '2026-11-01');
    store(2, -1000, '2026-11-01');
    expect(await balance()).toBe(600);
  });

  it('uses the latest setting and keeps earlier ones in the history', async () => {
    await setBalance(100, '2026-11-01');
    store(2, -1000, '2026-11-05');
    await setBalance(50, '2026-11-10');
    const body = await get();
    expect(body.balance).toBe(50);
    expect(body.balanceSettings.map((s) => s.amount)).toEqual([50, 100]);
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

  it('lowers the balance by the partner’s part of a refund or income', async () => {
    await setBalance(0, '2026-11-01');
    store(2, 200, '2026-11-02');
    expect(await balance()).toBe(-100);
  });

  it('leaves out transactions of hidden accounts and not-shared ones', async () => {
    await setBalance(0, '2026-11-01');
    store(1, -1000, '2026-11-02'); // Jag
    store(2, -1000, '2026-11-02', { share: 'me' });
    db.update(accounts).set({ hidden: true }).where(eq(accounts.id, 2)).run();
    store(2, -1000, '2026-11-02');
    expect(await balance()).toBe(0);
  });

  it('applies the share chosen for the transaction, including Hushåll and Partner', async () => {
    await api(app)
      .put('/api/household-ratio')
      .send({ entries: [{ from: '2026-01-01', percent: 60 }] } satisfies HouseholdRatioResponse)
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

  describe('settlements', () => {
    it('lower the balance, booked or pending, guessed or confirmed', async () => {
      await setBalance(4312, '2026-11-01');
      settle(3000, '2026-11-05');
      settle(1000, '2026-11-06', { status: 'pending', categoryConfirmed: false });
      expect(await balance()).toBe(312);
    });

    it('raise the balance when the owner pays the partner', async () => {
      await setBalance(0, '2026-11-01');
      settle(-200, '2026-11-05');
      expect(await balance()).toBe(200);
    });

    it('can leave the balance negative', async () => {
      await setBalance(100, '2026-11-01');
      settle(400, '2026-11-05');
      expect(await balance()).toBe(-300);
    });
  });

  describe('settlement periods', () => {
    it('are listed newest first, each closed by a settlement', async () => {
      await setBalance(100, '2026-10-01');
      const first = store(2, -1000, '2026-10-05');
      settle(550, '2026-10-20');
      store(2, -400, '2026-11-02');
      settle(200, '2026-11-10');
      store(2, -60, '2026-11-12');

      const { periods, balance } = await get();
      expect(balance).toBe(80);
      expect(periods.map((p) => [p.closedOn, p.carriedIn, p.paid, p.carriedOut])).toEqual([
        [null, 50, 0, 80],
        ['2026-11-10', 50, 200, 50],
        ['2026-10-20', 0, 550, 50],
      ]);
      expect(periods[2]?.items).toMatchObject([
        { transactionId: first, amount: -1000, share: 'half', partnerPart: 500 },
      ]);
      expect(periods[2]?.balanceSettings).toEqual([{ amount: 100, asOf: '2026-10-01' }]);
    });

    it('show a balance setting where it was made', async () => {
      await setBalance(100, '2026-10-01');
      settle(100, '2026-10-05');
      await setBalance(700, '2026-11-01');
      const { periods } = await get();
      expect(periods[0]?.balanceSettings).toEqual([{ amount: 700, asOf: '2026-11-01' }]);
      expect(periods[0]?.carriedOut).toBe(700);
    });

    it('change when a transaction books late, but not what was paid', async () => {
      await setBalance(0, '2026-10-01');
      settle(100, '2026-10-20');
      store(2, -200, '2026-10-10');
      const { periods } = await get();
      expect(periods[1]).toMatchObject({ paid: 100, carriedOut: 0 });
    });
  });
});
