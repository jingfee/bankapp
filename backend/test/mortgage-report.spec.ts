import type { INestApplication } from '@nestjs/common';
import type { CategoriesResponse, MortgageFiguresResponse } from '@bankapp/shared';
import { createApp } from '../src/app';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { FakeEnableBankingClient, api as signedIn, testConfig } from './support';

describe('mortgage figures', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let mortgageId: number;
  let otherId: number;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-12-05T12:00:00Z'),
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
    db.insert(connections)
      .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-06-01') })
      .run();
    for (const [n, hidden] of [
      ['Lönekonto', false],
      ['Gömt', true],
    ] as const) {
      db.insert(accounts)
        .values({
          connectionId: 1,
          identificationHash: n,
          uid: n,
          name: n,
          type: 'payment',
          currency: 'SEK',
          hidden,
        })
        .run();
    }
    const body = (await signedIn(app).get('/api/categories').expect(200))
      .body as CategoriesResponse;
    const subs = new Map(
      body.categories.flatMap((c) => c.subcategories).map((s) => [s.name, s.id]),
    );
    mortgageId = subs.get('Bolån ränta & amortering')!;
    otherId = subs.get('Livsmedel')!;
  });
  afterEach(() => app.close());

  let counter = 0;
  function pay(
    date: string,
    amount = -9000,
    extra: { status?: 'booked' | 'pending'; accountId?: number; subcategoryId?: number } = {},
  ) {
    counter += 1;
    db.insert(transactions)
      .values({
        accountId: extra.accountId ?? 1,
        status: extra.status ?? 'booked',
        amount,
        currency: 'SEK',
        date,
        description: `Bolån ${counter}`,
        dedupKey: `b${counter}`,
        raw: '{}',
        fetchedAt: new Date('2026-12-01T12:00:00Z'),
        subcategoryId: extra.subcategoryId ?? mortgageId,
      })
      .returning({ id: transactions.id })
      .get();
  }

  const post = (path: string, body: object = {}) =>
    signedIn(app).post(`/api/mortgage${path}`).send(body);
  const figures = async () =>
    (await signedIn(app).get('/api/mortgage/figures').expect(200)).body as MortgageFiguresResponse;

  async function setUp(overrides: object = {}) {
    const { body } = await post('/parts', {
      name: 'Del 1',
      startedOn: '2026-11-10',
      debt: 1_200_000,
      rate: 3,
      amortisation: 2000,
      rateAdjustment: { next: '2027-02-01', intervalMonths: 3 },
      termsChange: { next: '2027-03-01', intervalMonths: 12 },
      ...overrides,
    }).expect(201);
    return Math.max(...body.parts.map((part: { id: number }) => part.id)) as number;
  }

  it('is empty before the mortgage is set up', async () => {
    expect(await figures()).toEqual({ debts: [], months: [], monthsWithoutPayment: [] });
  });

  it('subtracts the amortisation once for each month paid after the entry', async () => {
    const id = await setUp();
    expect((await figures()).debts).toEqual([{ partId: id, debt: 1_200_000 }]);
    pay('2026-11-28');
    expect((await figures()).debts[0]!.debt).toBe(1_198_000);
    pay('2026-12-01');
    expect((await figures()).debts[0]!.debt).toBe(1_196_000);
  });

  it('keeps the debt in a month with no booked payment', async () => {
    await setUp({ startedOn: '2026-10-10' });
    pay('2026-10-28');
    // November and December (so far) have no booked payment.
    expect((await figures()).debts[0]!.debt).toBe(1_198_000);
  });

  it('subtracts once for two debits in a month, and ignores a payment on the entry day or before', async () => {
    await setUp();
    pay('2026-11-10');
    pay('2026-11-05');
    pay('2026-11-25', -6000);
    pay('2026-11-26', -3000);
    expect((await figures()).debts[0]!.debt).toBe(1_198_000);
  });

  it('does not subtract a pending payment until it books', async () => {
    await setUp();
    pay('2026-11-28', -9000, { status: 'pending' });
    expect((await figures()).debts[0]!.debt).toBe(1_200_000);
  });

  it('ignores payments on a hidden account and in other subcategories', async () => {
    await setUp();
    pay('2026-11-28', -9000, { accountId: 2 });
    pay('2026-11-28', -9000, { subcategoryId: otherId });
    const result = await figures();
    expect(result.debts[0]!.debt).toBe(1_200_000);
    expect(result.months.at(-1)!.paid).toBe(0);
  });

  it('is reset by a new entry, and only later payments count against it', async () => {
    const id = await setUp();
    pay('2026-11-28');
    await post('/entries', { date: '2026-12-02', debts: [{ partId: id, debt: 1_000_000 }] }).expect(
      201,
    );
    expect((await figures()).debts[0]!.debt).toBe(1_000_000);
    pay('2026-12-03');
    expect((await figures()).debts[0]!.debt).toBe(998_000);
  });

  it('applies a changed amortisation from its date', async () => {
    const id = await setUp();
    await post(`/parts/${id}/amortisation-changes`, { from: '2026-12-01', amount: 5000 }).expect(
      201,
    );
    pay('2026-11-28');
    pay('2026-12-01');
    expect((await figures()).debts[0]!.debt).toBe(1_200_000 - 2000 - 5000);
  });

  it('never goes below 0', async () => {
    await setUp({ debt: 3000 });
    pay('2026-11-28');
    pay('2026-12-01');
    expect((await figures()).debts[0]!.debt).toBe(0);
  });

  it('counts an ended part as 0', async () => {
    const id = await setUp();
    await post(`/parts/${id}/end`, { date: '2026-12-02' }).expect(201);
    expect((await figures()).debts[0]!.debt).toBe(0);
  });

  it("estimates each month from each part's own debt and rate, and the totals add up", async () => {
    const first = await setUp();
    const second = await setUp({
      name: 'Del 2',
      debt: 600_000,
      rate: 4.2,
      amortisation: 1000,
    });
    pay('2026-11-28');
    const { months } = await figures();
    const december = months.at(-1)!;
    expect(december.month).toBe('2026-12');
    // Both parts were paid in November, so December starts 2 000 and 1 000 lower.
    expect(december.debts).toEqual([
      { partId: first, debt: 1_198_000 },
      { partId: second, debt: 599_000 },
    ]);
    expect(december.interest).toBe(2995 + 2096.5);
    expect(december.amortisation).toBe(3000);
    expect(december.total).toBe(december.interest + december.amortisation);
    expect(months[0]).toMatchObject({
      month: '2026-11',
      interest: 3000 + 2100,
      amortisation: 3000,
    });
  });

  it('uses the rate in force on the first of the month', async () => {
    const id = await setUp();
    await post(`/parts/${id}/rate-changes`, { from: '2026-12-01', rate: 6 }).expect(201);
    await post(`/parts/${id}/rate-changes`, { from: '2026-12-02', rate: 9 }).expect(201);
    const { months } = await figures();
    expect(months.at(-1)!.interest).toBe(6000);
  });

  it('reports paid as the whole amount of booked and pending debits in the month', async () => {
    await setUp();
    pay('2026-11-28', -6000);
    pay('2026-11-29', -3000, { status: 'pending' });
    pay('2026-12-01', -9100);
    pay('2026-11-30', -500, { accountId: 2 });
    const { months } = await figures();
    expect(months.map((m) => [m.month, m.paid])).toEqual([
      ['2026-11', 9000],
      ['2026-12', 9100],
    ]);
  });

  it('lists ended months since the first entry with no booked payment', async () => {
    await setUp({ startedOn: '2026-09-10' });
    pay('2026-09-28');
    pay('2026-11-28', -9000, { status: 'pending' });
    // October has none, November only a pending one; December is not over yet.
    expect((await figures()).monthsWithoutPayment).toEqual(['2026-10', '2026-11']);
  });
});
