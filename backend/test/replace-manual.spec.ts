import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type {
  CategoriesResponse,
  OverviewResponse,
  SettlementResponse,
  Transaction,
  TransactionReviewResponse,
  TransactionsResponse,
} from '@bankapp/shared';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, transactions } from '../src/db/schema';
import { FakeEnableBankingClient, testConfig, api } from './support';

describe('replacing a manual transaction with its bank transaction', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let groceries: number;
  let keys = 0;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-11-15T12:00:00'),
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
    const body = (await api(app).get('/api/categories').expect(200)).body as CategoriesResponse;
    groceries = body.categories
      .flatMap((c) => c.subcategories)
      .find((s) => s.name === 'Livsmedel')!.id;
    db.insert(connections)
      .values({ bankName: 'Coop', sessionId: 's', validUntil: new Date('2027-06-01') })
      .run();
    db.insert(accounts)
      .values({
        connectionId: 1,
        identificationHash: 'h',
        uid: 'u',
        name: 'Mastercard',
        type: 'card',
        currency: 'SEK',
        connectedOn: '2026-11-12',
      })
      .run();
  });

  afterEach(() => app.close());

  const manual = async (body: Record<string, unknown> = {}) =>
    (
      await api(app)
        .post('/api/transactions')
        .send({
          description: 'Coop',
          amount: -245,
          subcategoryId: groceries,
          date: '2026-11-10',
          share: 'half',
          ...body,
        })
        .expect(201)
    ).body as Transaction;
  const bankTransaction = (values: Partial<typeof transactions.$inferInsert> = {}) =>
    db
      .insert(transactions)
      .values({
        accountId: 1,
        status: 'booked',
        amount: -247.5,
        currency: 'SEK',
        date: '2026-11-12',
        description: 'COOP KONSUM',
        dedupKey: `k${keys++}`,
        raw: '{}',
        fetchedAt: new Date(),
        ...values,
      })
      .returning({ id: transactions.id })
      .get().id;
  const review = async () =>
    (await api(app).get('/api/transactions/review').expect(200)).body as TransactionReviewResponse;
  const replace = (manualId: number, bankId: number) =>
    api(app).post('/api/transactions/replace').send({ manualId, bankId });
  const notSame = (manualId: number, bankId: number) =>
    api(app).post('/api/transactions/not-same').send({ manualId, bankId });
  const listed = async () =>
    (await api(app).get('/api/transactions').expect(200)).body as TransactionsResponse;
  const overview = async () =>
    (await api(app).get('/api/overview').query({ month: '2026-11', view: 'full' }))
      .body as OverviewResponse;
  const settlement = async () =>
    (await api(app).get('/api/settlement').expect(200)).body as SettlementResponse;
  const setBalance = () =>
    api(app)
      .post('/api/settlement/balance-settings')
      .send({ amount: 0, asOf: '2026-11-01' })
      .expect(201);

  it('suggests the bank transaction and, after Ersätt, counts the purchase once', async () => {
    await setBalance();
    const m = await manual();
    const b = bankTransaction();
    expect((await settlement()).balance).toBe(122.5);

    const suggested = await review();
    expect(suggested.replacements).toHaveLength(1);
    expect(suggested.replacements[0]).toMatchObject({
      manual: { id: m.id },
      bank: { id: b },
    });
    expect(suggested.count).toBe(2); // the guessed bank transaction and the suggestion

    await replace(m.id, b).expect(204);

    expect((await review()).replacements).toEqual([]);
    expect((await listed()).transactions.map((t) => t.id)).toEqual([b]);
    const [row] = (await listed()).transactions;
    expect(row).toMatchObject({
      category: { confirmed: true, subcategory: { id: groceries } },
      share: { option: 'half' },
    });
    expect((await overview()).totals.spending).toBe(247.5);
    // Dated before the account was connected, yet it counts: 50% of 247,50.
    expect((await settlement()).balance).toBe(123.75);
  });

  it('does not suggest what is too far in amount or date, or not paid by the owner', async () => {
    await manual();
    bankTransaction({ amount: -251 }); // tolerance is 4,90
    bankTransaction({ date: '2026-11-16' }); // six days
    bankTransaction({ amount: 247.5 }); // money in
    expect((await review()).replacements).toEqual([]);
    const near = bankTransaction({ amount: -249.9, date: '2026-11-15', status: 'pending' });
    expect((await review()).replacements.map((r) => r.bank.id)).toEqual([near]);

    await manual({ description: 'Partner', paidBy: 'partner', amount: -100 });
    bankTransaction({ amount: -100 });
    expect((await review()).replacements).toHaveLength(1);
  });

  it('suggests with a floor of 2 kr for small amounts and the closest first', async () => {
    const small = await manual({ amount: -20 });
    const closeOne = bankTransaction({ amount: -21.9 });
    expect((await review()).replacements.map((r) => r.bank.id)).toEqual([closeOne]);
    const exact = bankTransaction({ amount: -20 });
    const found = (await review()).replacements;
    expect(found.map((r) => [r.manual.id, r.bank.id])).toEqual([[small.id, exact]]);
  });

  it('never suggests a pair again after Inte samma', async () => {
    const m = await manual();
    const b = bankTransaction();
    await notSame(m.id, b).expect(204);
    expect((await review()).replacements).toEqual([]);
    expect((await listed()).transactions.map((t) => t.id).sort()).toEqual([m.id, b].sort());
  });

  it('does not suggest a bank transaction that already replaces another', async () => {
    const first = await manual();
    const b = bankTransaction();
    await replace(first.id, b).expect(204);
    await manual({ description: 'Coop igen' });
    expect((await review()).replacements).toEqual([]);
  });

  it('brings the manual transaction back when a replacing pending transaction is dropped', async () => {
    const m = await manual();
    const b = bankTransaction({ status: 'pending' });
    await replace(m.id, b).expect(204);
    expect((await listed()).transactions.map((t) => t.id)).toEqual([b]);
    db.delete(transactions).where(eq(transactions.id, b)).run();
    expect((await listed()).transactions.map((t) => t.id)).toEqual([m.id]);
  });

  it('refuses pairs that are not manual-and-bank', async () => {
    const m = await manual();
    const b = bankTransaction();
    await replace(b, m.id).expect(400);
    await replace(m.id, 9999).expect(404);
    await replace(m.id, b).expect(204);
    await replace(m.id, bankTransaction()).expect(409);
    await notSame(b, m.id).expect(400);
    await replace(m.id, bankTransaction({ amount: 100 })).expect(400);
  });
});
