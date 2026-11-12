import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  CategoriesResponse,
  TransactionCategory,
  TransactionDetails,
  TransactionsResponse,
} from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

describe('categorising a transaction by hand', () => {
  let app: INestApplication;
  let db: AppDatabase;

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
      .values({
        connectionId: 1,
        identificationHash: 'h1',
        uid: 'u1',
        name: 'Lönekonto',
        type: 'payment',
        currency: 'SEK',
      })
      .run();
    db.insert(transactions)
      .values({
        accountId: 1,
        status: 'booked',
        amount: -250,
        currency: 'SEK',
        date: '2026-11-08',
        description: 'ICA Nara Hornstull',
        dedupKey: 'k1',
        raw: '{}',
        fetchedAt: new Date('2026-11-10T12:00:00Z'),
      })
      .run();
  });

  afterEach(() => app.close());

  const server = () => app.getHttpServer();

  async function subcategoryId(name: string, category: string): Promise<number> {
    const body = (await request(server()).get('/api/categories').expect(200))
      .body as CategoriesResponse;
    const found = body.categories
      .find((c) => c.name === category)
      ?.subcategories.find((s) => s.name === name);
    if (!found) throw new Error(`No subcategory ${category} / ${name}`);
    return found.id;
  }

  const detail = async (id = 1): Promise<TransactionDetails> =>
    (await request(server()).get(`/api/transactions/${id}`).expect(200)).body;
  const listed = async () =>
    ((await request(server()).get('/api/transactions').expect(200)).body as TransactionsResponse)
      .transactions[0];
  const put = (body: unknown, id: string | number = 1) =>
    request(server())
      .put(`/api/transactions/${id}/category`)
      .send(body as object);

  it('starts out uncategorised', async () => {
    expect((await detail()).category).toBeNull();
    expect((await listed()).category).toBeNull();
  });

  it('saves the chosen subcategory as confirmed and shows it in the list and on the detail page', async () => {
    const livsmedel = await subcategoryId('Livsmedel', 'Mat & Dryck');

    const response = await put({ subcategoryId: livsmedel }).expect(200);

    const expected: TransactionCategory = {
      category: { id: expect.any(Number) as number, name: 'Mat & Dryck', colour: 'green' },
      subcategory: { id: livsmedel, name: 'Livsmedel', icon: 'shopping-basket' },
      confirmed: true,
    };
    expect(response.body).toEqual({ category: expected });
    expect((await detail()).category).toEqual(expected);
    expect((await listed()).category).toEqual(expected);
  });

  it('can be changed to another subcategory', async () => {
    await put({ subcategoryId: await subcategoryId('Livsmedel', 'Mat & Dryck') }).expect(200);

    await put({ subcategoryId: await subcategoryId('Alkohol', 'Mat & Dryck') }).expect(200);

    expect((await detail()).category?.subcategory.name).toBe('Alkohol');
  });

  it('can be removed, making the transaction uncategorised', async () => {
    await put({ subcategoryId: await subcategoryId('Livsmedel', 'Mat & Dryck') }).expect(200);

    const response = await put({ subcategoryId: null }).expect(200);

    expect(response.body).toEqual({ category: null });
    expect((await detail()).category).toBeNull();
  });

  it('refuses an unknown subcategory or a malformed body', async () => {
    await put({ subcategoryId: 9999 }).expect(400);
    await put({ subcategoryId: 'Livsmedel' }).expect(400);
    await put({}).expect(400);
    expect((await detail()).category).toBeNull();
  });

  it('answers 404 for an unknown transaction', async () => {
    const livsmedel = await subcategoryId('Livsmedel', 'Mat & Dryck');
    await put({ subcategoryId: livsmedel }, 99).expect(404);
    await put({ subcategoryId: livsmedel }, 'abc').expect(404);
  });
});
