import type { INestApplication } from '@nestjs/common';
import type { AccountsResponse, SavingsResponse } from '@bankapp/shared';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import {
  accounts,
  authorisations,
  balances,
  connections,
  manualSavingsAccounts,
  replaceRejections,
  syncAccountResults,
  transactions,
} from '../src/db/schema';
import type { EnableBankingAccount } from '../src/enable-banking/enable-banking-client';
import { createApp } from '../src/app';
import { bank, FakeEnableBankingClient, testConfig, api } from './support';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const account = (n: number, name: string): EnableBankingAccount => ({
  uid: `uid-${n}`,
  identificationHash: `hash-${n}`,
  name,
  type: 'payment',
  currency: 'SEK',
  raw: '{}',
});

describe('deleting a removed bank for good', () => {
  let app: INestApplication;
  let enableBanking: FakeEnableBankingClient;

  beforeEach(async () => {
    enableBanking = new FakeEnableBankingClient();
    enableBanking.banks = [bank('Swedbank'), bank('Handelsbanken')];
    app = await createApp({
      config: testConfig,
      enableBanking,
      database: { inMemory: true },
      now: () => NOW,
    });
    await app.init();
  });

  afterEach(() => app.close());

  const db = () => app.get<AppDatabase>(DATABASE);
  const list = async () =>
    (await api(app).get('/api/accounts').expect(200)).body as AccountsResponse;

  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      if (!(await list()).syncing) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async function connect(name: string, sessionId: string, accountList: EnableBankingAccount[]) {
    enableBanking.session = {
      sessionId,
      validUntil: new Date(NOW.getTime() + 90 * 24 * 3600 * 1000),
      accounts: accountList,
    };
    await api(app).post('/api/connections').send({ bank: name }).expect(201);
    const state = enableBanking.authorisations.at(-1)!.state;
    await api(app)
      .get('/api/connections/callback')
      .query({ code: `code-${sessionId}`, state })
      .expect(302);
    await settle();
  }

  const remove = (name: string, continueManually?: string) =>
    api(app)
      .delete(`/api/connections/${encodeURIComponent(name)}`)
      .query(continueManually === undefined ? {} : { continueManually })
      .expect(204);
  const erase = (name: string) =>
    api(app).delete(`/api/connections/${encodeURIComponent(name)}/permanent`);

  function addTransaction(
    accountId: number | null,
    description: string,
    extra: Partial<typeof transactions.$inferInsert> = {},
  ): number {
    return db()
      .insert(transactions)
      .values({
        accountId,
        status: 'booked',
        amount: -100,
        currency: 'SEK',
        date: '2026-10-05',
        description,
        dedupKey: description,
        raw: '{}',
        fetchedAt: NOW,
        ...extra,
      })
      .returning({ id: transactions.id })
      .get().id;
  }

  it('refuses a bank that is still in use, or unknown', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);

    await erase('Swedbank').expect(409);
    await erase('Handelsbanken').expect(404);

    expect((await list()).banks.map((group) => group.bank)).toEqual(['Swedbank']);
  });

  it('leaves no row that refers to the bank, its accounts or its transactions', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);
    await connect('Handelsbanken', 'session-2', [account(2, 'Privatkonto')]);
    const gone = addTransaction(1, 'Köp');
    const kept = addTransaction(2, 'Annat');
    db()
      .insert(balances)
      .values({ accountId: 1, type: 'CLBD', amount: 5, currency: 'SEK', fetchedAt: NOW })
      .run();
    const manual = addTransaction(null, 'Manuell', { dedupKey: 'manual' });
    db()
      .insert(replaceRejections)
      .values({ manualTransactionId: manual, bankTransactionId: gone })
      .run();
    await remove('Swedbank');

    await erase('Swedbank').expect(204);

    const handle = db();
    expect(
      handle
        .select()
        .from(connections)
        .all()
        .map((c) => c.bankName),
    ).toEqual(['Handelsbanken']);
    expect(
      handle
        .select()
        .from(accounts)
        .all()
        .map((a) => a.id),
    ).toEqual([2]);
    expect(handle.select().from(transactions).where(eq(transactions.id, gone)).all()).toEqual([]);
    expect(handle.select().from(transactions).where(eq(transactions.id, kept)).all()).toHaveLength(
      1,
    );
    expect(handle.select().from(balances).where(eq(balances.accountId, 1)).all()).toEqual([]);
    expect(
      handle.select().from(syncAccountResults).where(eq(syncAccountResults.accountId, 1)).all(),
    ).toEqual([]);
    expect(handle.select().from(replaceRejections).all()).toEqual([]);
    expect(
      handle.select().from(authorisations).where(eq(authorisations.bankName, 'Swedbank')).all(),
    ).toEqual([]);
    expect((await list()).removedBanks).toEqual([]);
  });

  it('keeps a refund offset against a deleted purchase, without the link', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);
    await connect('Handelsbanken', 'session-2', [account(2, 'Privatkonto')]);
    const purchase = addTransaction(1, 'Köp');
    const refund = addTransaction(2, 'Retur', {
      amount: 100,
      offsetsTransactionId: purchase,
      share: 'half',
    });
    await remove('Swedbank');

    await erase('Swedbank').expect(204);

    const row = db().select().from(transactions).where(eq(transactions.id, refund)).get()!;
    expect(row.offsetsTransactionId).toBeNull();
    expect(row.share).toBe('half');
  });

  it('brings back a manual transaction that a deleted transaction replaced', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);
    const manual = addTransaction(null, 'Manuell', { dedupKey: 'manual' });
    addTransaction(1, 'Köp', { replacesTransactionId: manual });
    await remove('Swedbank');

    await erase('Swedbank').expect(204);

    const shown = (await api(app).get('/api/transactions').expect(200)).body as {
      transactions: { description: string }[];
    };
    expect(shown.transactions.map((t) => t.description)).toEqual(['Manuell']);
  });

  it('keeps a savings account that continued as a manual one', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto'), account(2, 'Sparkonto')]);
    await api(app).put('/api/accounts/2/savings').send({ savings: true }).expect(200);
    db()
      .insert(balances)
      .values({ accountId: 2, type: 'CLBD', amount: 1500, currency: 'SEK', fetchedAt: NOW })
      .run();
    await remove('Swedbank', '2');

    await erase('Swedbank').expect(204);

    expect(db().select().from(manualSavingsAccounts).all()).toHaveLength(1);
    const view = (await api(app).get('/api/savings').expect(200)).body as SavingsResponse;
    expect(view.accounts).toHaveLength(1);
    expect(view.accounts[0]).toMatchObject({ kind: 'manual', name: 'Sparkonto', balance: 1500 });
  });

  it('can connect the bank again afterwards, as a new bank', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);
    await remove('Swedbank');
    await erase('Swedbank').expect(204);

    await connect('Swedbank', 'session-2', [account(1, 'Lönekonto')]);

    expect((await list()).banks.map((group) => group.bank)).toEqual(['Swedbank']);
  });
});
