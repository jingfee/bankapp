import type { INestApplication } from '@nestjs/common';
import type { AccountsResponse, TransactionsResponse } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, transactions } from '../src/db/schema';
import { createApp } from '../src/app';
import { savingsFigures } from '../src/accounts/savings-figures';
import { FakeEnableBankingClient, testConfig, api } from './support';

describe('marking an account as a savings account', () => {
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

  const mark = (id: number, savings: boolean) =>
    api(app).put(`/api/accounts/${id}/savings`).send({ savings });
  const hide = (id: number, hidden: boolean) =>
    api(app).put(`/api/accounts/${id}/hidden`).send({ hidden });
  const listed = async () =>
    (await api(app).get('/api/transactions').expect(200)).body as TransactionsResponse;
  const accountList = async () =>
    ((await api(app).get('/api/accounts').expect(200)).body as AccountsResponse).banks[0]!.accounts;

  it('removes its transactions everywhere but keeps the account visible', async () => {
    await mark(2, true).expect(200);
    expect((await listed()).transactions.map((t) => t.description)).toEqual(['Köp 1']);
    await api(app).get('/api/transactions/2').expect(404);
    expect((await accountList()).map((a) => [a.name, a.savings, a.hidden])).toEqual([
      ['Lönekonto', false, false],
      ['Sparkonto', true, false],
    ]);
  });

  it('brings the transactions back when unmarked', async () => {
    await mark(2, true).expect(200);
    await mark(2, false).expect(200);
    expect((await listed()).transactions).toHaveLength(2);
  });

  it('un-hides an account marked as savings, and unmarks one that is hidden', async () => {
    await hide(2, true).expect(200);
    await mark(2, true).expect(200);
    expect((await accountList())[1]).toMatchObject({ savings: true, hidden: false });
    await hide(2, true).expect(200);
    expect((await accountList())[1]).toMatchObject({ savings: false, hidden: true });
  });

  it('showing a savings account keeps it a savings account', async () => {
    await mark(2, true).expect(200);
    await hide(2, false).expect(200);
    expect((await accountList())[1]).toMatchObject({ savings: true, hidden: false });
  });

  it('rejects a bad body and an unknown account', async () => {
    await api(app).put('/api/accounts/1/savings').send({}).expect(400);
    await mark(99, true).expect(404);
  });

  describe('net deposits and growth', () => {
    beforeEach(() => {
      const rows: [string, number, string][] = [
        ['2026-01-05', 1000, 'Insättning'],
        ['2026-02-05', 500, 'Insättning'],
        ['2026-02-28', 12, 'Ränta'],
        ['2026-03-10', -200, 'Uttag'],
        ['2026-03-31', 8, 'KAPITALRÄNTA'],
      ];
      rows.forEach(([date, amount, description], i) =>
        db
          .insert(transactions)
          .values({
            accountId: 2,
            status: 'booked',
            amount,
            currency: 'SEK',
            date,
            description,
            dedupKey: `s${i}`,
            raw: '{}',
            fetchedAt: new Date('2026-11-10T12:00:00Z'),
          })
          .run(),
      );
    });

    it('counts deposits and withdrawals but not interest', () => {
      expect(savingsFigures(db, 2, '2026-02-28', 1512).netDeposits).toBe(1500);
      expect(savingsFigures(db, 2, '2026-03-31', 1320).netDeposits).toBe(1300);
    });

    it('works out growth as the balance minus net deposits', () => {
      expect(savingsFigures(db, 2, '2026-03-31', 1320).growth).toBe(20);
      expect(savingsFigures(db, 2, '2026-02-28', 1512).growth).toBe(12);
    });

    it('is zero before the first transaction', () => {
      expect(savingsFigures(db, 2, '2025-12-31', 0)).toEqual({ netDeposits: 0, growth: 0 });
    });
  });
});
