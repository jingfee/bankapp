import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  AccountsResponse,
  OverviewResponse,
  TransactionReviewResponse,
  TransactionsResponse,
} from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { createApp } from '../src/app';
import { FakeEnableBankingClient, testConfig } from './support';

describe('hiding an account', () => {
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
    [1, 2].forEach((accountId) =>
      db
        .insert(transactions)
        .values({
          accountId,
          status: 'booked',
          amount: -10,
          currency: 'SEK',
          date: '2026-11-10',
          description: `Köp ${accountId}`,
          dedupKey: `k${accountId}`,
          raw: '{}',
          fetchedAt: new Date('2026-11-10T12:00:00Z'),
        })
        .run(),
    );
  });

  afterEach(() => app.close());

  const server = () => app.getHttpServer();
  const hide = (id: number, hidden: boolean) =>
    request(server()).put(`/api/accounts/${id}/hidden`).send({ hidden });
  const listed = async () =>
    (await request(server()).get('/api/transactions').expect(200)).body as TransactionsResponse;

  it('marks the account hidden and keeps it listed for the Banker page', async () => {
    await hide(2, true).expect(200);
    const body = (await request(server()).get('/api/accounts').expect(200))
      .body as AccountsResponse;
    expect(body.banks[0]?.accounts.map((a) => [a.name, a.hidden])).toEqual([
      ['Lönekonto', false],
      ['Sparkonto', true],
    ]);
  });

  it('removes its transactions from the list, the review, the overview and the details', async () => {
    expect((await listed()).transactions).toHaveLength(2);
    await hide(2, true).expect(200);

    expect((await listed()).transactions.map((t) => t.description)).toEqual(['Köp 1']);
    const review = (await request(server()).get('/api/transactions/review').expect(200))
      .body as TransactionReviewResponse;
    expect(review.transactions.map((t) => t.description)).toEqual(['Köp 1']);
    const overview = (
      await request(server()).get('/api/overview').query({ month: '2026-11' }).expect(200)
    ).body as OverviewResponse;
    expect(overview.uncategorised).toBe(1);
    await request(server()).get('/api/transactions/2').expect(404);
    await request(server()).get('/api/transactions/1').expect(200);
  });

  it('brings everything back when the account is shown again', async () => {
    await hide(2, true).expect(200);
    await hide(2, false).expect(200);
    expect((await listed()).transactions).toHaveLength(2);
  });

  it('rejects a bad body and an unknown account', async () => {
    await request(server()).put('/api/accounts/1/hidden').send({}).expect(400);
    await hide(99, true).expect(404);
  });
});
