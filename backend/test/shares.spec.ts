import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  AccountsResponse,
  CategoriesResponse,
  HouseholdRatioResponse,
  ShareOption,
  SubcategorySharesResponse,
  TransactionDetails,
  TransactionsResponse,
} from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, subcategories, transactions } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

describe('shares', () => {
  let app: INestApplication;
  let db: AppDatabase;
  let subcategoryIds: Map<string, number>;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
    db.insert(connections)
      .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-06-01') })
      .run();
    db.insert(accounts)
      .values(
        ['Lönekonto', 'Coop Mastercard'].map((name, i) => ({
          connectionId: 1,
          identificationHash: `h${i}`,
          uid: `u${i}`,
          name,
          type: i === 0 ? ('payment' as const) : ('card' as const),
          currency: 'SEK',
        })),
      )
      .run();
    const body = (await request(server()).get('/api/categories').expect(200))
      .body as CategoriesResponse;
    subcategoryIds = new Map(
      body.categories.flatMap((c) => c.subcategories).map((s) => [s.name, s.id]),
    );
  });

  afterEach(() => app.close());

  const server = () => app.getHttpServer();

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

  const setAccountShare = (id: number, share: ShareOption) =>
    request(server()).put(`/api/accounts/${id}/share`).send({ share });
  const setRatio = (entries: HouseholdRatioResponse['entries']) =>
    request(server()).put('/api/household-ratio').send({ entries });
  const setSubcategoryShare = (name: string, share: ShareOption) =>
    request(server())
      .put(`/api/subcategories/${subcategoryIds.get(name)}/share`)
      .send({ share });
  const subcategoryShares = async () =>
    (
      (await request(server()).get('/api/subcategory-shares').expect(200))
        .body as SubcategorySharesResponse
    ).shares;
  const share = async (id: number) =>
    (
      (await request(server()).get(`/api/transactions/${id}`).expect(200))
        .body as TransactionDetails
    ).share;

  describe('the account share', () => {
    it('is Jag until the owner sets one, and is listed on Banker', async () => {
      const body = (await request(server()).get('/api/accounts').expect(200))
        .body as AccountsResponse;
      expect(body.banks[0]?.accounts.map((a) => a.share)).toEqual(['me', 'me']);
    });

    it('is stored when set', async () => {
      await setAccountShare(2, 'half').expect(200);
      const body = (await request(server()).get('/api/accounts').expect(200))
        .body as AccountsResponse;
      expect(body.banks[0]?.accounts.map((a) => [a.name, a.share])).toEqual([
        ['Coop Mastercard', 'half'],
        ['Lönekonto', 'me'],
      ]);
    });

    it('rejects an unknown option and an unknown account', async () => {
      await request(server()).put('/api/accounts/2/share').send({ share: 'most' }).expect(400);
      await setAccountShare(99, 'half').expect(404);
    });

    it('cannot be Hushåll until a household ratio exists', async () => {
      await setAccountShare(1, 'household').expect(409);
      await setRatio([{ from: '2026-01-01', percent: 60 }]).expect(200);
      await setAccountShare(1, 'household').expect(200);
    });
  });

  describe('the subcategory share', () => {
    it('is Jag, and so not listed, until the owner sets one', async () => {
      expect(await subcategoryShares()).toEqual([]);
    });

    it('is stored when set and listed with its subcategory', async () => {
      await setSubcategoryShare('Kortbetalning', 'half').expect(200);
      expect(await subcategoryShares()).toEqual([
        { subcategoryId: subcategoryIds.get('Kortbetalning'), share: 'half' },
      ]);
    });

    it('is cleared by choosing Jag', async () => {
      await setSubcategoryShare('Kortbetalning', 'partner').expect(200);
      await setSubcategoryShare('Kortbetalning', 'me').expect(200);
      expect(await subcategoryShares()).toEqual([]);
    });

    it('rejects an unknown option and an unknown subcategory', async () => {
      await request(server()).put('/api/subcategories/1/share').send({ share: 'most' }).expect(400);
      await request(server())
        .put('/api/subcategories/9999/share')
        .send({ share: 'half' })
        .expect(404);
      await request(server())
        .put('/api/subcategories/abc/share')
        .send({ share: 'half' })
        .expect(404);
    });

    it('cannot be Hushåll until a household ratio exists', async () => {
      await setSubcategoryShare('Kortbetalning', 'household').expect(409);
      await setRatio([{ from: '2026-01-01', percent: 60 }]).expect(200);
      await setSubcategoryShare('Kortbetalning', 'household').expect(200);
    });

    it('applies Hushåll on a Jag account, and loses to a card account’s 50/50', async () => {
      await setRatio([{ from: '2026-01-01', percent: 60 }]).expect(200);
      await setSubcategoryShare('Kortbetalning', 'household').expect(200);
      const subcategoryId = subcategoryIds.get('Kortbetalning')!;
      const onJagAccount = store(1, -100, '2026-11-10', { subcategoryId });
      const onCard = store(2, -100, '2026-11-10', { subcategoryId });
      await setAccountShare(2, 'half').expect(200);
      expect(await share(onJagAccount)).toEqual({
        option: 'household',
        percent: 60,
        source: 'subcategory',
      });
      expect(await share(onCard)).toEqual({ option: 'half', percent: 50, source: 'account' });
    });

    it('applies to transactions in every month', async () => {
      await setSubcategoryShare('Kortbetalning', 'partner').expect(200);
      const subcategoryId = subcategoryIds.get('Kortbetalning')!;
      const old = store(1, -100, '2025-03-10', { subcategoryId });
      const recent = store(1, -100, '2026-11-10', { subcategoryId });
      expect((await share(old)).option).toBe('partner');
      expect((await share(recent)).option).toBe('partner');
    });
  });

  describe('the effective share of a transaction', () => {
    it('is Jag, from the default, when nothing is set', async () => {
      const id = store(1, -100, '2026-11-10');
      expect(await share(id)).toEqual({ option: 'me', percent: 100, source: 'default' });
    });

    it('follows transaction, then account, then subcategory, then Jag', async () => {
      const id = store(2, -100, '2026-11-10', {
        subcategoryId: subcategoryIds.get('Kortbetalning')!,
      });
      db.update(subcategories)
        .set({ share: 'partner' })
        .where(eq(subcategories.id, subcategoryIds.get('Kortbetalning')!))
        .run();
      expect(await share(id)).toEqual({ option: 'partner', percent: 0, source: 'subcategory' });

      await setAccountShare(2, 'half').expect(200);
      expect(await share(id)).toEqual({ option: 'half', percent: 50, source: 'account' });

      db.update(transactions).set({ share: 'me' }).where(eq(transactions.id, id)).run();
      expect(await share(id)).toEqual({ option: 'me', percent: 100, source: 'transaction' });
    });

    it('lets an account that is not set defer to its subcategory, and choosing Jag clears it', async () => {
      const id = store(1, -100, '2026-11-10', {
        subcategoryId: subcategoryIds.get('Kortbetalning')!,
      });
      db.update(subcategories).set({ share: 'half' }).run();
      expect(await share(id)).toEqual({ option: 'half', percent: 50, source: 'subcategory' });
      await setAccountShare(1, 'partner').expect(200);
      expect(await share(id)).toEqual({ option: 'partner', percent: 0, source: 'account' });
      await setAccountShare(1, 'me').expect(200);
      expect(await share(id)).toEqual({ option: 'half', percent: 50, source: 'subcategory' });
    });

    it('is included for every listed transaction', async () => {
      await setAccountShare(2, 'half').expect(200);
      store(2, -100, '2026-11-10');
      store(1, -100, '2026-11-09');
      const body = (await request(server()).get('/api/transactions').expect(200))
        .body as TransactionsResponse;
      expect(body.transactions.map((t) => [t.share.option, t.share.source])).toEqual([
        ['half', 'account'],
        ['me', 'default'],
      ]);
    });
  });

  describe('Hushåll', () => {
    it('uses the ratio in force on the transaction date', async () => {
      await setRatio([
        { from: '2026-01-01', percent: 60 },
        { from: '2026-07-01', percent: 55 },
      ]).expect(200);
      await setAccountShare(1, 'household').expect(200);
      const before = store(1, -100, '2026-06-30');
      const after = store(1, -100, '2026-07-01');
      expect(await share(before)).toEqual({ option: 'household', percent: 60, source: 'account' });
      expect(await share(after)).toEqual({ option: 'household', percent: 55, source: 'account' });
    });

    it('uses the first entry for a date before it', async () => {
      await setRatio([{ from: '2026-05-01', percent: 60 }]).expect(200);
      await setAccountShare(1, 'household').expect(200);
      expect((await share(store(1, -100, '2026-01-01'))).percent).toBe(60);
    });

    it('is stored sorted and validated', async () => {
      await setRatio([]).expect(400);
      await setRatio([{ from: '2026-01-01', percent: 0 }]).expect(400);
      await setRatio([{ from: '2026-01-01', percent: 50.5 }]).expect(400);
      await setRatio([{ from: 'januari', percent: 50 }]).expect(400);
      await setRatio([
        { from: '2026-01-01', percent: 50 },
        { from: '2026-01-01', percent: 60 },
      ]).expect(400);
      const body = (
        await setRatio([
          { from: '2026-07-01', percent: 55 },
          { from: '2026-01-01', percent: 60 },
        ]).expect(200)
      ).body as HouseholdRatioResponse;
      expect(body.entries.map((e) => e.from)).toEqual(['2026-01-01', '2026-07-01']);
      expect(
        (
          (await request(server()).get('/api/household-ratio').expect(200))
            .body as HouseholdRatioResponse
        ).entries,
      ).toEqual(body.entries);
    });

    it('a new entry changes only transactions dated from it', async () => {
      await setRatio([{ from: '2026-01-01', percent: 60 }]).expect(200);
      await setSubcategoryShare('Kortbetalning', 'household').expect(200);
      const subcategoryId = subcategoryIds.get('Kortbetalning')!;
      const before = store(1, -100, '2026-08-31', { subcategoryId });
      const from = store(1, -100, '2026-09-01', { subcategoryId });
      await setRatio([
        { from: '2026-01-01', percent: 60 },
        { from: '2026-09-01', percent: 50 },
      ]).expect(200);
      expect((await share(before)).percent).toBe(60);
      expect((await share(from)).percent).toBe(50);
    });

    it('cannot lose its last entry while Hushåll is in use', async () => {
      await setRatio([{ from: '2026-01-01', percent: 60 }]).expect(200);
      await setAccountShare(1, 'household').expect(200);
      await setRatio([]).expect(400);
    });
  });

  describe('an offset refund', () => {
    it('reports its purchase’s share: a Jag-account refund against a 50/50 card purchase is 50%', async () => {
      await setAccountShare(2, 'half').expect(200);
      const purchase = store(2, -200, '2026-11-01');
      const refund = store(1, 200, '2026-11-12');
      expect(await share(refund)).toEqual({ option: 'me', percent: 100, source: 'default' });

      await request(server())
        .put(`/api/transactions/${refund}/offset`)
        .send({ purchaseId: purchase })
        .expect(200);
      expect(await share(refund)).toEqual({ option: 'half', percent: 50, source: 'purchase' });

      await request(server())
        .put(`/api/transactions/${refund}/offset`)
        .send({ purchaseId: null })
        .expect(200);
      expect(await share(refund)).toEqual({ option: 'me', percent: 100, source: 'default' });
    });

    it('uses the ratio in force on the purchase’s date', async () => {
      await setRatio([
        { from: '2026-01-01', percent: 60 },
        { from: '2026-11-10', percent: 50 },
      ]).expect(200);
      await setAccountShare(2, 'household').expect(200);
      const purchase = store(2, -200, '2026-11-01');
      const refund = store(1, 200, '2026-11-20');
      await request(server())
        .put(`/api/transactions/${refund}/offset`)
        .send({ purchaseId: purchase })
        .expect(200);
      expect(await share(refund)).toEqual({ option: 'household', percent: 60, source: 'purchase' });
    });

    it('is shown on the purchase’s page and in the list', async () => {
      await setAccountShare(2, 'half').expect(200);
      const purchase = store(2, -200, '2026-11-01');
      const refund = store(1, 50, '2026-11-12');
      await request(server())
        .put(`/api/transactions/${refund}/offset`)
        .send({ purchaseId: purchase })
        .expect(200);
      const list = (await request(server()).get('/api/transactions').expect(200))
        .body as TransactionsResponse;
      expect(list.transactions.find((t) => t.id === refund)?.share.source).toBe('purchase');
    });
  });

  it('seeds Överföring › Avräkning delade utgifter', async () => {
    const body = (await request(server()).get('/api/categories').expect(200))
      .body as CategoriesResponse;
    const transfer = body.categories.find((c) => c.kind === 'transfer');
    expect(transfer?.subcategories.map((s) => s.name)).toContain('Avräkning delade utgifter');
  });
});
