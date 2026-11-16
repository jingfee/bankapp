import type { INestApplication } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, connections, subcategories, transactions } from '../src/db/schema';
import { queryTransactions } from '../src/transactions/query';
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
        ['Lönekonto', 'Sparkonto'].map((name, i) => ({
          connectionId: 1,
          identificationHash: `h${i}`,
          uid: `u${i}`,
          name,
          type: 'payment' as const,
          currency: 'SEK',
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
});
