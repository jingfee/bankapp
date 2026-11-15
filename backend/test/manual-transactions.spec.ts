import type { INestApplication } from '@nestjs/common';
import type {
  CategoriesResponse,
  OverviewResponse,
  SettlementResponse,
  Transaction,
  TransactionDetails,
  TransactionReviewResponse,
  TransactionsResponse,
} from '@bankapp/shared';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, transactions } from '../src/db/schema';
import { FakeEnableBankingClient, testConfig, api } from './support';

describe('manual transactions', () => {
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
    const body = (await api(app).get('/api/categories').expect(200)).body as CategoriesResponse;
    subcategoryIds = new Map(
      body.categories.flatMap((c) => c.subcategories).map((s) => [s.name, s.id]),
    );
  });

  afterEach(() => app.close());

  const groceries = () => subcategoryIds.get('Livsmedel')!;

  const add = (body: Record<string, unknown> = {}) =>
    api(app)
      .post('/api/transactions')
      .send({
        description: 'ICA Maxi',
        amount: -300,
        subcategoryId: groceries(),
        date: '2026-11-10',
        share: 'half',
        ...body,
      });
  const create = async (body: Record<string, unknown> = {}) =>
    (await add(body).expect(201)).body as Transaction;
  const overview = async (view: 'full' | 'mine') =>
    (await api(app).get('/api/overview').query({ month: '2026-11', view }).expect(200))
      .body as OverviewResponse;
  const settlement = async () =>
    (await api(app).get('/api/settlement').expect(200)).body as SettlementResponse;
  const listed = async () =>
    (await api(app).get('/api/transactions').expect(200)).body as TransactionsResponse;
  const setBalance = () =>
    api(app)
      .post('/api/settlement/balance-settings')
      .send({ amount: 0, asOf: '2026-11-01' })
      .expect(201);

  it('adds a transaction with no account that shows in the list as confirmed and booked', async () => {
    const created = await create();
    expect(created).toMatchObject({
      status: 'booked',
      amount: { amount: -300, currency: 'SEK' },
      date: '2026-11-10',
      description: 'ICA Maxi',
      account: null,
      share: { option: 'half', percent: 50 },
      category: { confirmed: true, subcategory: { name: 'Livsmedel' } },
    });
    expect((await listed()).transactions).toEqual([created]);
  });

  it('defaults to today and to the subcategory’s share', async () => {
    await api(app)
      .put(`/api/subcategories/${groceries()}/share`)
      .send({ share: 'half' })
      .expect(200);
    const created = (
      await api(app)
        .post('/api/transactions')
        .send({ description: 'Mjölk', amount: -20, subcategoryId: groceries() })
        .expect(201)
    ).body as Transaction;
    expect(created.date).toBe('2026-11-15');
    expect(created.share).toEqual({ option: 'half', percent: 50, source: 'subcategory' });
  });

  it('validates the request', async () => {
    await add({ description: '  ' }).expect(400);
    await add({ amount: 'mycket' }).expect(400);
    await add({ amount: 0 }).expect(400);
    await add({ amount: 0.004 }).expect(400);
    await add({ amount: 1e12 }).expect(400);
    await add({ description: 'x'.repeat(201) }).expect(400);
    await add({ subcategoryId: null }).expect(400);
    await add({ subcategoryId: 99999 }).expect(400);
    await add({ date: '2026-02-30' }).expect(400);
    await add({ share: 'most' }).expect(400);
    await add({ share: 'household' }).expect(409); // no household ratio yet
  });

  it('is never in Review', async () => {
    await create({ date: '2026-11-12' });
    const review = (await api(app).get('/api/transactions/review').expect(200))
      .body as TransactionReviewResponse;
    expect(review.count).toBe(0);
    expect((await api(app).get('/api/transactions/review/count')).body).toEqual({
      count: 0,
    });
  });

  it('counts in the overview, in full and as Min andel', async () => {
    await create();
    expect((await overview('full')).totals.spending).toBe(300);
    expect((await overview('mine')).totals.spending).toBe(150);
    const listedForSub = (
      await api(app)
        .get('/api/overview/transactions')
        .query({ month: '2026-11', subcategoryId: groceries() })
        .expect(200)
    ).body as { transactions: Transaction[] };
    expect(listedForSub.transactions.map((t) => t.account)).toEqual([null]);
  });

  it('moves the settlement balance by the partner’s part and shows Manuell', async () => {
    await setBalance();
    await create();
    const body = await settlement();
    expect(body.balance).toBe(150);
    expect(body.periods[0]!.items[0]).toMatchObject({ accountName: 'Manuell', partnerPart: 150 });
  });

  it('defaults to paid by the owner', async () => {
    expect((await create()).paidBy).toBe('owner');
  });

  it('paid by the partner lowers the settlement balance by the owner’s part, the overview counting both', async () => {
    await setBalance();
    const created = await create({ amount: -100, paidBy: 'partner' });
    expect(created.paidBy).toBe('partner');
    expect(created.amount.amount).toBe(-100);
    const body = await settlement();
    expect(body.balance).toBe(-50);
    expect(body.periods[0]!.items[0]).toMatchObject({ accountName: 'Manuell', partnerPart: -50 });
    expect((await overview('mine')).totals.spending).toBe(50);
    expect((await overview('full')).totals.spending).toBe(100);
  });

  it('paid by the partner counts the owner’s whole part even when the share is theirs alone', async () => {
    await setBalance();
    await create({ amount: -100, paidBy: 'partner', share: 'me' });
    expect((await settlement()).balance).toBe(-100);
  });

  it('can be edited to and from paid by the partner', async () => {
    await setBalance();
    const created = await create({ amount: -100 });
    expect((await settlement()).balance).toBe(50);
    const edited = (
      await api(app)
        .put(`/api/transactions/${created.id}`)
        .send({
          description: 'ICA Maxi',
          amount: -100,
          subcategoryId: groceries(),
          share: 'half',
          paidBy: 'partner',
        })
        .expect(200)
    ).body as Transaction;
    expect(edited.paidBy).toBe('partner');
    expect((await settlement()).balance).toBe(-50);
  });

  it('keeps who paid when an edit leaves paidBy out', async () => {
    const created = await create({ paidBy: 'partner' });
    const edited = (
      await api(app)
        .put(`/api/transactions/${created.id}`)
        .send({ description: 'Ny text', amount: -300, subcategoryId: groceries() })
        .expect(200)
    ).body as Transaction;
    expect(edited.paidBy).toBe('partner');
  });

  it('rejects an unknown paid by', async () => {
    await add({ paidBy: 'bank' }).expect(400);
  });

  it('is kept when accounts are joined or hidden', async () => {
    db.insert(connections)
      .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-06-01') })
      .run();
    db.insert(accounts)
      .values({
        connectionId: 1,
        identificationHash: 'h',
        uid: 'u',
        name: 'Lönekonto',
        type: 'payment',
        currency: 'SEK',
        hidden: true,
      })
      .run();
    await setBalance();
    const created = await create();
    expect((await listed()).transactions.map((t) => t.id)).toEqual([created.id]);
    expect((await overview('full')).totals.spending).toBe(300);
    expect((await settlement()).balance).toBe(150);
    await api(app).get(`/api/transactions/${created.id}`).expect(200);
  });

  it('shows its details without an account', async () => {
    const created = await create();
    const details = (await api(app).get(`/api/transactions/${created.id}`).expect(200))
      .body as TransactionDetails;
    expect(details).toMatchObject({
      account: null,
      status: 'booked',
      transactionDate: '2026-11-10',
    });
  });

  it('can be edited, which updates the list, overview and settlement', async () => {
    await setBalance();
    const created = await create();
    const edited = (
      await api(app)
        .put(`/api/transactions/${created.id}`)
        .send({
          description: 'ICA Kvantum',
          amount: -500,
          subcategoryId: subcategoryIds.get('Restaurang') ?? groceries(),
          date: '2026-11-11',
          share: 'partner',
        })
        .expect(200)
    ).body as Transaction;
    expect(edited).toMatchObject({
      id: created.id,
      description: 'ICA Kvantum',
      amount: { amount: -500 },
      date: '2026-11-11',
      share: { option: 'partner', percent: 0 },
      account: null,
    });
    expect((await overview('full')).totals.spending).toBe(500);
    expect((await overview('mine')).totals.spending).toBe(0);
    expect((await settlement()).balance).toBe(500);
  });

  it('can be edited back to the subcategory’s share', async () => {
    const created = await create();
    const edited = (
      await api(app)
        .put(`/api/transactions/${created.id}`)
        .send({ description: 'ICA', amount: -300, subcategoryId: groceries(), share: null })
        .expect(200)
    ).body as Transaction;
    expect(edited.share.option).toBe('me');
    expect(edited.date).toBe('2026-11-10');
  });

  it('can be deleted, which updates the list, overview and settlement', async () => {
    await setBalance();
    const created = await create();
    await api(app).delete(`/api/transactions/${created.id}`).expect(204);
    expect((await listed()).transactions).toEqual([]);
    expect((await overview('full')).totals.spending).toBe(0);
    expect((await settlement()).balance).toBe(0);
    await api(app).delete(`/api/transactions/${created.id}`).expect(404);
    await api(app).get(`/api/transactions/${created.id}`).expect(404);
  });

  it('is the only kind of transaction that can be edited or deleted', async () => {
    db.insert(connections)
      .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-06-01') })
      .run();
    db.insert(accounts)
      .values({
        connectionId: 1,
        identificationHash: 'h',
        uid: 'u',
        name: 'Lönekonto',
        type: 'payment',
        currency: 'SEK',
      })
      .run();
    const bank = db
      .insert(transactions)
      .values({
        accountId: 1,
        status: 'booked',
        amount: -100,
        currency: 'SEK',
        date: '2026-11-10',
        description: 'Bank',
        dedupKey: 'k',
        raw: '{}',
        fetchedAt: new Date(),
      })
      .returning({ id: transactions.id })
      .get().id;
    await api(app)
      .put(`/api/transactions/${bank}`)
      .send({ description: 'x', amount: -1, subcategoryId: groceries() })
      .expect(409);
    await api(app).delete(`/api/transactions/${bank}`).expect(409);
  });

  it('ends the offset links of a transaction whose direction is edited', async () => {
    const purchase = await create({ share: null });
    const refund = await create({ amount: 100, description: 'Retur', share: null });
    await api(app)
      .put(`/api/transactions/${refund.id}/offset`)
      .send({ purchaseId: purchase.id })
      .expect(200);
    await api(app)
      .put(`/api/transactions/${purchase.id}`)
      .send({ description: 'Insättning', amount: 300, subcategoryId: groceries() })
      .expect(200);
    const details = (await api(app).get(`/api/transactions/${refund.id}`).expect(200))
      .body as TransactionDetails;
    expect(details.offsets).toBeNull();
  });

  it('deleting a purchase unlinks the refunds offset against it', async () => {
    const purchase = await create({ share: null });
    const refund = await create({ amount: 100, description: 'Retur', share: null });
    await api(app)
      .put(`/api/transactions/${refund.id}/offset`)
      .send({ purchaseId: purchase.id })
      .expect(200);
    await api(app).delete(`/api/transactions/${purchase.id}`).expect(204);
    const details = (await api(app).get(`/api/transactions/${refund.id}`).expect(200))
      .body as TransactionDetails;
    expect(details.offsets).toBeNull();
  });
});
