import type { INestApplication } from '@nestjs/common';
import type { TransactionDetails, TransactionsResponse } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, categories, connections, subcategories, transactions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig, api } from './support';

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

  const get = (query = '') => api(app).get(`/api/transactions${query}`);
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
    expect(await list()).toEqual({ transactions: [], nextCursor: null, count: 0, sum: null });
  });

  it('answers 400 for a bad cursor', async () => {
    await get('?before=nonsense').expect(400);
  });

  describe('search and filters', () => {
    /** The id of a seeded category and its first subcategory. */
    function category(name: string): { categoryId: number; subcategoryId: number } {
      const found = db.select().from(categories).where(eq(categories.name, name)).get()!;
      const sub = db
        .select()
        .from(subcategories)
        .where(eq(subcategories.categoryId, found.id))
        .get()!;
      return { categoryId: found.id, subcategoryId: sub.id };
    }

    const descriptions = async (query: string) =>
      (await list(query)).transactions.map((t) => t.description);

    it('searches the description, ignoring case', async () => {
      add({ date: '2026-11-01', description: 'ICA Maxi' });
      add({ date: '2026-11-02', description: 'Coop' });
      add({ date: '2026-11-03', description: 'Parkering på ica-torget' });

      expect(await descriptions('?q=ica')).toEqual(['Parkering på ica-torget', 'ICA Maxi']);
    });

    it('ignores the case of Swedish letters too', async () => {
      add({ date: '2026-11-01', description: 'Åhléns Öresund' });

      expect(await descriptions('?q=' + encodeURIComponent('åhléns'))).toHaveLength(1);
      expect(await descriptions('?q=' + encodeURIComponent('ÖRESUND'))).toHaveLength(1);
    });

    it('treats % and _ in the search as plain characters', async () => {
      add({ date: '2026-11-01', description: '50% rabatt' });
      add({ date: '2026-11-02', description: 'Annat' });

      expect(await descriptions('?q=' + encodeURIComponent('%'))).toEqual(['50% rabatt']);
      expect(await descriptions('?q=_')).toEqual([]);
    });

    it('filters on dates, both ends inclusive', async () => {
      add({ date: '2026-10-31', description: 'a' });
      add({ date: '2026-11-01', description: 'b' });
      add({ date: '2026-11-30', description: 'c' });
      add({ date: '2026-12-01', description: 'd' });

      expect(await descriptions('?from=2026-11-01&to=2026-11-30')).toEqual(['c', 'b']);
      expect(await descriptions('?from=2026-11-30')).toEqual(['d', 'c']);
      expect(await descriptions('?to=2026-10-31')).toEqual(['a']);
    });

    it('filters on accounts, where manual means manual transactions', async () => {
      add({ date: '2026-11-01', description: 'one' }, 1);
      add({ date: '2026-11-02', description: 'two' }, 2);
      add({ date: '2026-11-03', description: 'manual', accountId: null });

      expect(await descriptions('?accounts=2')).toEqual(['two']);
      expect(await descriptions('?accounts=manual')).toEqual(['manual']);
      expect(await descriptions('?accounts=1,manual')).toEqual(['manual', 'one']);
    });

    it('filters on categories, by the subcategory’s category, where none means uncategorised', async () => {
      const food = category('Mat & Dryck');
      const home = category('Boende & Hushåll');
      add({ date: '2026-11-01', description: 'food', subcategoryId: food.subcategoryId });
      add({ date: '2026-11-02', description: 'home', subcategoryId: home.subcategoryId });
      add({ date: '2026-11-03', description: 'nothing' });

      expect(await descriptions(`?categories=${food.categoryId}`)).toEqual(['food']);
      expect(await descriptions('?categories=none')).toEqual(['nothing']);
      expect(await descriptions(`?categories=none,${home.categoryId}`)).toEqual([
        'nothing',
        'home',
      ]);
    });

    it('filters on money out or in', async () => {
      add({ date: '2026-11-01', description: 'out', amount: -50 });
      add({ date: '2026-11-02', description: 'in', amount: 50 });

      expect(await descriptions('?kind=out')).toEqual(['out']);
      expect(await descriptions('?kind=in')).toEqual(['in']);
    });

    it('bounds the absolute amount in kronor, inclusive', async () => {
      add({ date: '2026-11-01', description: 'small', amount: -99.5 });
      add({ date: '2026-11-02', description: 'medium', amount: -100 });
      add({ date: '2026-11-03', description: 'incoming', amount: 500 });
      add({ date: '2026-11-04', description: 'large', amount: -500.01 });

      expect(await descriptions('?min=100&max=500')).toEqual(['incoming', 'medium']);
      expect(await descriptions('?max=99.5')).toEqual(['small']);
      expect(await descriptions('?min=500.01')).toEqual(['large']);
    });

    it('combines everything with AND and keeps hidden accounts out', async () => {
      const food = category('Mat & Dryck');
      add({
        date: '2026-11-05',
        description: 'ICA',
        amount: -250,
        subcategoryId: food.subcategoryId,
      });
      add(
        {
          date: '2026-11-06',
          description: 'ICA elsewhere',
          amount: -250,
          subcategoryId: food.subcategoryId,
        },
        2,
      );
      add({
        date: '2026-11-07',
        description: 'ICA too small',
        amount: -20,
        subcategoryId: food.subcategoryId,
      });
      add({
        date: '2026-10-07',
        description: 'ICA October',
        amount: -250,
        subcategoryId: food.subcategoryId,
      });
      db.update(accounts).set({ hidden: true }).where(eq(accounts.id, 2)).run();

      const query = `?q=ica&accounts=1&categories=${food.categoryId}&kind=out&min=100&max=500&from=2026-11-01&to=2026-11-30`;
      expect(await descriptions(query)).toEqual(['ICA']);
      expect(await descriptions('?q=elsewhere')).toEqual([]);
    });

    it('counts and sums every match, not just the page', async () => {
      for (let day = 1; day <= 28; day++) {
        const date = `2026-11-${String(day).padStart(2, '0')}`;
        add({ date, amount: -10 });
        add({ date, amount: -5.5 });
      }
      add({ date: '2026-10-01', amount: -1000 });

      const first = await list('?from=2026-11-01');
      expect(first.transactions).toHaveLength(50);
      expect(first.nextCursor).not.toBeNull();
      expect(first.count).toBe(56);
      expect(first.sum).toEqual({ amount: -434, currency: 'SEK' });

      const second = await list(`?from=2026-11-01&before=${first.nextCursor}`);
      expect(second.transactions).toHaveLength(6);
      expect(second.nextCursor).toBeNull();
      expect(second.count).toBe(56);
    });

    it('has no sum when the matches mix currencies', async () => {
      add({ date: '2026-11-01', amount: -10 });
      add({ date: '2026-11-02', amount: -10, currency: 'EUR' });

      const body = await list();
      expect(body.count).toBe(2);
      expect(body.sum).toBeNull();
    });

    it.each([
      '?from=2026-13-01',
      '?to=yesterday',
      '?accounts=abc',
      '?accounts=1,,2',
      '?categories=food',
      '?kind=sideways',
      '?min=-1',
      '?min=abc',
      '?max=Infinity',
      '?min=1&min=2',
    ])('answers 400 for %s', async (query) => {
      await get(query).expect(400);
    });
  });

  describe('GET /api/transactions/:id', () => {
    const detail = async (id: number): Promise<TransactionDetails> =>
      (await api(app).get(`/api/transactions/${id}`).expect(200)).body;

    it('returns the details parsed from the raw response', async () => {
      const raw = {
        credit_debit_indicator: 'DBIT',
        transaction_amount: { amount: '12.50', currency: 'EUR' },
        creditor: { name: 'Café Roma' },
        debtor: { name: 'Me' },
        exchange_rate: {
          exchange_rate: '11.2',
          instructed_amount: { amount: '1.12', currency: 'EUR' },
        },
        remittance_information: ['Lunch', 'Rome'],
        reference_number: '12345',
        note: 'Team trip',
      };
      add({
        date: '2026-11-08',
        description: 'Lunch Rome',
        amount: -12.5,
        transactionDate: '2026-11-08',
        bookingDate: '2026-11-10',
        valueDate: '2026-11-10',
        raw: JSON.stringify(raw),
      });

      const body = await detail(1);

      expect(body).toEqual({
        id: 1,
        status: 'booked',
        amount: { amount: -12.5, currency: 'SEK' },
        description: 'Lunch Rome',
        account: { id: 1, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
        category: null,
        share: { option: 'me', percent: 100, source: 'default' },
        ownerPart: -12.5,
        paidBy: 'owner',
        transactionDate: '2026-11-08',
        bookingDate: '2026-11-10',
        counterparty: 'Café Roma',
        originalAmount: { amount: -1.12, currency: 'EUR' },
        exchangeRate: 11.2,
        remittanceInformation: ['Lunch', 'Rome'],
        referenceNumber: '12345',
        note: 'Team trip',
        offsets: null,
        refunds: [],
        netAmount: null,
        raw: JSON.stringify(raw),
      });
      expect(body).not.toHaveProperty('valueDate');
    });

    it('uses the debtor as the other party when money arrived', async () => {
      add({
        date: '2026-11-08',
        amount: 100,
        raw: JSON.stringify({
          credit_debit_indicator: 'CRDT',
          creditor: { name: 'Me' },
          debtor: { name: 'Employer AB' },
        }),
      });

      expect((await detail(1)).counterparty).toBe('Employer AB');
    });

    it('leaves out what the bank did not send, also when the raw is not usable', async () => {
      add({ date: '2026-11-08', bookingDate: null, status: 'pending' });
      add({ date: '2026-11-08', raw: 'not json' });

      for (const id of [1, 2]) {
        expect(await detail(id)).toMatchObject({
          transactionDate: null,
          counterparty: null,
          originalAmount: null,
          exchangeRate: null,
          remittanceInformation: [],
          referenceNumber: null,
          note: null,
        });
      }
    });

    it('answers 404 for an unknown or non-numeric id', async () => {
      await api(app).get('/api/transactions/99').expect(404);
      await api(app).get('/api/transactions/abc').expect(404);
    });
  });
});
