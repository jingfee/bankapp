import type { INestApplication } from '@nestjs/common';
import type {
  SetHouseholdRatioRequest,
  OverviewResponse,
  SettlementResponse,
  ShareOption,
  TransactionDetails,
  TransactionsResponse,
} from '@bankapp/shared';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, subcategories, transactions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { ownerPart } from '../src/transactions/owners-part';
import { FakeEnableBankingClient, testConfig, api } from './support';

describe('ownerPart', () => {
  it('rounds half away from zero to whole öre', () => {
    expect(ownerPart(-10.05, 50)).toBe(-5.03);
    expect(ownerPart(10.05, 50)).toBe(5.03);
    expect(ownerPart(-10.04, 50)).toBe(-5.02);
  });

  it('is exact at 0 and 100 per cent, and never negative zero', () => {
    expect(ownerPart(-123.45, 100)).toBe(-123.45);
    expect(ownerPart(-123.45, 0)).toBe(0);
    expect(Object.is(ownerPart(-123.45, 0), 0)).toBe(true);
  });
});

describe('the owner’s part of a transaction', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let counter = 0;

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
    db.insert(accounts)
      .values({
        connectionId: 1,
        identificationHash: 'h',
        uid: 'u',
        name: 'Coop Mastercard',
        type: 'card',
        currency: 'SEK',
      })
      .run();
  });

  afterEach(() => app.close());

  function store(
    amount: number,
    date: string,
    values: Partial<typeof transactions.$inferInsert> = {},
  ): number {
    counter += 1;
    return db
      .insert(transactions)
      .values({
        accountId: 1,
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

  const setShare = (share: ShareOption) =>
    api(app).put('/api/accounts/1/share').send({ share }).expect(200);
  const listed = async (id: number) =>
    (
      (await api(app).get('/api/transactions').expect(200)).body as TransactionsResponse
    ).transactions.find((t) => t.id === id)!;
  const details = async (id: number) =>
    (await api(app).get(`/api/transactions/${id}`).expect(200)).body as TransactionDetails;

  it('rounds half away from zero for a negative amount, in the list and on the details page', async () => {
    await setShare('half');
    const id = store(-10.05, '2026-11-02');
    expect((await listed(id)).ownerPart).toBe(-5.03);
    expect((await details(id)).ownerPart).toBe(-5.03);
  });

  it('rounds a positive half-öre away from zero too', async () => {
    await setShare('half');
    expect((await listed(store(10.05, '2026-11-02'))).ownerPart).toBe(5.03);
  });

  it('is all of the amount for Jag and none of it for Partner', async () => {
    const id = store(-99.99, '2026-11-02');
    expect((await listed(id)).ownerPart).toBe(-99.99);
    await setShare('partner');
    expect((await listed(id)).ownerPart).toBe(0);
  });

  it('uses the Hushåll ratio in force on the transaction’s date', async () => {
    await api(app)
      .put('/api/household-ratio')
      .send({
        entries: [
          { from: '2026-01-01', percent: 60 },
          { from: '2026-11-10', percent: 55 },
        ],
      } satisfies SetHouseholdRatioRequest)
      .expect(200);
    await setShare('household');
    const before = store(-100.1, '2026-11-09');
    const after = store(-100.1, '2026-11-10');
    expect((await listed(before)).ownerPart).toBe(-60.06);
    expect((await listed(after)).ownerPart).toBe(-55.06);
  });

  it('gives a fully refunded shared purchase exactly 0 kr, for the owner and for the partner', async () => {
    await setShare('half');
    const purchase = store(-10.05, '2026-11-02');
    const refund = store(10.05, '2026-11-05');
    await api(app)
      .put(`/api/transactions/${refund}/offset`)
      .send({ purchaseId: purchase })
      .expect(200);
    const parts = [(await listed(purchase)).ownerPart, (await listed(refund)).ownerPart];
    expect(parts[0]! + parts[1]!).toBe(0);
  });

  describe('Overview Min andel', () => {
    function categorise(id: number, name: string) {
      const sub = db.select().from(subcategories).where(eq(subcategories.name, name)).get()!;
      db.update(transactions).set({ subcategoryId: sub.id }).where(eq(transactions.id, id)).run();
      return sub;
    }

    it('is the sum of each transaction’s rounded owner’s part', async () => {
      await setShare('half');
      const ids = [
        store(-10.05, '2026-11-02'),
        store(-10.05, '2026-11-03'),
        store(-0.01, '2026-11-04'),
      ];
      for (const id of ids) categorise(id, 'Livsmedel');
      const overview = (
        await api(app).get('/api/overview').query({ month: '2026-11', view: 'mine' }).expect(200)
      ).body as OverviewResponse;
      // -5.03, -5.03 and -0.01 (half of a single öre rounds away from zero)
      expect(overview.totals.spending).toBe(10.07);
    });
  });

  describe('the settlement', () => {
    const setBalance = () =>
      api(app)
        .post('/api/settlement/balance-settings')
        .send({ amount: 0, asOf: '2026-11-01' })
        .expect(201);
    const balance = async () =>
      (await api(app).get('/api/settlement').expect(200)).body as SettlementResponse;

    it('uses amount − owner’s part as the partner’s part of what the owner paid', async () => {
      await setShare('half');
      await setBalance();
      const id = store(-10.05, '2026-11-02');
      const body = await balance();
      expect(body.balance).toBe(5.02); // -10.05 − (−5.03)
      expect(body.periods[0]!.items[0]).toMatchObject({ transactionId: id, partnerPart: 5.02 });
    });

    it('a fully refunded shared purchase adds nothing', async () => {
      await setShare('half');
      await setBalance();
      const purchase = store(-10.05, '2026-11-02');
      const refund = store(10.05, '2026-11-05');
      await api(app)
        .put(`/api/transactions/${refund}/offset`)
        .send({ purchaseId: purchase })
        .expect(200);
      expect((await balance()).balance).toBe(0);
    });
  });
});
