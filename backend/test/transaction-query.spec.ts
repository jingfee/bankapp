import type { INestApplication } from '@nestjs/common';
import { desc, eq, gte } from 'drizzle-orm';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, subcategories, transactions } from '../src/db/schema';
import { queryTransactions, summariseTransactions } from '../src/transactions/query';
import { FakeEnableBankingClient, testConfig } from './support';

describe('the transaction query', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let keys = 0;

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
      .values(
        ['Lönekonto', 'Gömt konto', 'Sparkonto'].map((name, i) => ({
          connectionId: 1,
          identificationHash: `h${i}`,
          uid: `u${i}`,
          name,
          type: 'payment' as const,
          currency: 'SEK',
          savings: name === 'Sparkonto',
        })),
      )
      .run();
  });

  afterEach(() => app.close());

  const add = (description: string, values: Partial<typeof transactions.$inferInsert> = {}) =>
    db
      .insert(transactions)
      .values({
        accountId: 1,
        status: 'booked',
        amount: -10,
        currency: 'SEK',
        date: '2026-11-10',
        description,
        dedupKey: `k${(keys += 1)}`,
        raw: '{}',
        fetchedAt: new Date('2026-11-10T12:00:00Z'),
        ...values,
      })
      .returning({ id: transactions.id })
      .get().id;

  const described = (where?: Parameters<typeof queryTransactions>[1]) =>
    queryTransactions(db, where).map((t) => t.description);

  it('leaves out the transactions of a hidden account', () => {
    add('Visible');
    add('Hidden', { accountId: 2 });
    db.update(accounts).set({ hidden: true }).where(eq(accounts.id, 2)).run();
    expect(described({ orderBy: [] })).toEqual(['Visible']);
  });

  it('leaves out a manual transaction that a bank transaction replaces', () => {
    const replaced = add('Manual replaced', { accountId: null });
    add('Bank', { replacesTransactionId: replaced });
    expect(described().sort()).toEqual(['Bank']);
  });

  it('keeps a manual transaction that is not replaced', () => {
    add('Manual', { accountId: null });
    const [manual] = queryTransactions(db);
    expect(manual?.description).toBe('Manual');
    expect(manual?.account).toBeNull();
  });

  it('resolves the share from the transaction, its account or its subcategory', () => {
    const subcategory = db.select().from(subcategories).limit(1).get()!;
    db.update(subcategories)
      .set({ share: 'half' })
      .where(eq(subcategories.id, subcategory.id))
      .run();
    add('By subcategory', { subcategoryId: subcategory.id });
    add('By transaction', { subcategoryId: subcategory.id, share: 'partner' });
    add('Default');
    const shares = Object.fromEntries(
      queryTransactions(db).map((t) => [t.description, [t.share.source, t.share.percent]]),
    );
    expect(shares).toEqual({
      'By subcategory': ['subcategory', 50],
      'By transaction': ['transaction', 0],
      Default: ['default', 100],
    });
  });

  it('applies the order and limit on top of the visibility rule', () => {
    add('Old', { date: '2026-11-01' });
    add('New', { date: '2026-11-09' });
    add('Newest', { date: '2026-11-10' });
    expect(described({ orderBy: [desc(transactions.date)], limit: 2 })).toEqual(['Newest', 'New']);
  });

  describe('countIn', () => {
    it('puts a kvittad refund in its purchase month, or in its own date', () => {
      const purchase = add('Purchase', { date: '2026-10-30', amount: -100 });
      add('Refund', { date: '2026-11-03', amount: 40, offsetsTransactionId: purchase });
      const october = { from: '2026-10-01', before: '2026-11-01' };
      const november = { from: '2026-11-01', before: '2026-12-01' };
      const names = (query: Parameters<typeof queryTransactions>[1]) =>
        queryTransactions(db, query)
          .map((t) => t.description)
          .sort();

      expect(names({ ...october, countIn: 'purchase-month' })).toEqual(['Purchase', 'Refund']);
      expect(names({ ...november, countIn: 'purchase-month' })).toEqual([]);
      expect(names({ ...october, countIn: 'own-date' })).toEqual(['Purchase']);
      expect(names(november)).toEqual(['Refund']);
    });

    it('carries the purchase date and the category on the row', () => {
      const purchase = add('Purchase', { date: '2026-10-30' });
      add('Refund', { date: '2026-11-03', offsetsTransactionId: purchase });
      const refund = queryTransactions(db).find((t) => t.description === 'Refund')!;
      expect(refund.purchaseDate).toBe('2026-10-30');
      expect(refund.kind).toBeNull();
    });
  });

  describe('sinceConnected', () => {
    beforeEach(() => {
      db.update(accounts).set({ connectedOn: '2026-11-05' }).where(eq(accounts.id, 1)).run();
    });
    const names = () =>
      queryTransactions(db, { sinceConnected: true })
        .map((t) => t.description)
        .sort();

    it('leaves out a transaction dated before its account was first connected', () => {
      add('Before', { date: '2026-11-04' });
      add('On', { date: '2026-11-05' });
      expect(names()).toEqual(['On']);
      expect(queryTransactions(db)).toHaveLength(2);
    });

    it('keeps a manual transaction', () => {
      add('Manual', { accountId: null, date: '2026-01-01' });
      expect(names()).toEqual(['Manual']);
    });

    it('keeps a bank transaction dated earlier when it replaces a manual one', () => {
      const manual = add('Manual', { accountId: null, date: '2026-11-01' });
      add('Bank', { date: '2026-11-01', replacesTransactionId: manual });
      expect(names()).toEqual(['Bank']);
    });
  });

  describe('summariseTransactions', () => {
    it('agrees with the listed transactions and leaves out what does not count', () => {
      add('A', { amount: -10 });
      add('B', { amount: -5.5 });
      add('Hidden', { accountId: 2, amount: -1000 });
      db.update(accounts).set({ hidden: true }).where(eq(accounts.id, 2)).run();
      add('Savings', { accountId: 3, amount: -2000 });
      const replaced = add('Replaced', { accountId: null, amount: -3000 });
      add('Bank', { amount: -3000, replacesTransactionId: replaced });

      const listed = queryTransactions(db, { where: gte(transactions.date, '2026-11-01') });
      const totals = summariseTransactions(db, { where: gte(transactions.date, '2026-11-01') });

      expect(totals.count).toBe(listed.length);
      expect(totals.sum).toBeCloseTo(listed.reduce((sum, t) => sum + t.amount.amount, 0));
      expect(totals).toMatchObject({ count: 3, currencies: 1, currency: 'SEK' });
    });

    it('counts the currencies', () => {
      add('SEK', { amount: -1 });
      add('EUR', { amount: -1, currency: 'EUR' });
      expect(summariseTransactions(db).currencies).toBe(2);
    });
  });
});
