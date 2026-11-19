import type { INestApplication } from '@nestjs/common';
import type { AccountsResponse, SavingsResponse } from '@bankapp/shared';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, balances, transactions } from '../src/db/schema';
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

describe('removing a bank', () => {
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

  async function connect(name: string, sessionId: string, list: EnableBankingAccount[]) {
    enableBanking.session = {
      sessionId,
      validUntil: new Date(NOW.getTime() + 90 * 24 * 3600 * 1000),
      accounts: list,
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
      .query(continueManually === undefined ? {} : { continueManually });

  function addTransaction(accountId: number, description: string) {
    db()
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
      })
      .run();
  }

  it('revokes the session, closes the accounts and moves the bank to Borttagna banker', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto'), account(2, 'Sparkonto')]);

    await remove('Swedbank').expect(204);

    expect(enableBanking.deletedSessions).toEqual(['session-1']);
    const result = await list();
    expect(result.banks).toEqual([]);
    expect(result.removedBanks.map((group) => group.bank)).toEqual(['Swedbank']);
    expect(result.removedBanks[0]!.accounts.map((a) => a.name)).toEqual(['Lönekonto', 'Sparkonto']);
    expect(
      db()
        .select()
        .from(accounts)
        .all()
        .every((row) => row.closed),
    ).toBe(true);
  });

  it('only removes the bank asked for', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);
    await connect('Handelsbanken', 'session-2', [account(2, 'Privatkonto')]);

    await remove('Swedbank').expect(204);

    const result = await list();
    expect(result.banks.map((group) => group.bank)).toEqual(['Handelsbanken']);
    expect(result.banks[0]!.accounts).toHaveLength(1);
  });

  it('is not found for a bank that is not connected or already removed', async () => {
    await remove('Swedbank').expect(404);
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);
    await remove('Swedbank').expect(204);
    await remove('Swedbank').expect(404);
  });

  it('still removes the bank, and logs, when revoking fails', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);
    enableBanking.failDeleteWith = new Error('Enable Banking answered 500');

    await remove('Swedbank').expect(204);

    expect((await list()).removedBanks.map((group) => group.bank)).toEqual(['Swedbank']);
  });

  it('stops syncing it, scheduled and manual', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto')]);
    await remove('Swedbank').expect(204);
    enableBanking.requestedBalances = [];

    await api(app).post('/api/sync').expect(202);
    await settle();

    expect(enableBanking.requestedBalances).toEqual([]);
  });

  it('keeps its transactions counting and a hidden account hidden', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto'), account(2, 'Dolt')]);
    addTransaction(1, 'Synlig');
    addTransaction(2, 'Dold');
    await api(app).put('/api/accounts/2/hidden').send({ hidden: true }).expect(200);

    await remove('Swedbank').expect(204);

    const shown = (await api(app).get('/api/transactions').expect(200)).body as {
      transactions: { description: string }[];
    };
    expect(shown.transactions.map((t) => t.description)).toEqual(['Synlig']);
    const hidden = (await list()).removedBanks[0]!.accounts.find((a) => a.name === 'Dolt');
    expect(hidden?.hidden).toBe(true);
    expect(
      db().select().from(transactions).where(eq(transactions.accountId, 2)).all(),
    ).toHaveLength(1);
  });

  it('is brought back by connecting the same bank again, as a renewal', async () => {
    await connect('Swedbank', 'session-1', [account(1, 'Lönekonto'), account(2, 'Sparkonto')]);
    addTransaction(1, 'Före borttagning');
    await remove('Swedbank').expect(204);

    await connect('Swedbank', 'session-2', [account(1, 'Lönekonto'), account(2, 'Sparkonto')]);

    const result = await list();
    expect(result.removedBanks).toEqual([]);
    expect(result.banks.map((group) => group.bank)).toEqual(['Swedbank']);
    expect(result.banks[0]!.accounts.map((a) => a.name)).toEqual(['Lönekonto', 'Sparkonto']);
    expect(result.banks[0]!.closedAccounts).toEqual([]);
    expect(
      db()
        .select()
        .from(accounts)
        .all()
        .map((row) => row.id),
    ).toEqual([1, 2]);
    expect(db().select().from(transactions).all()).toHaveLength(1);
  });

  describe('savings accounts', () => {
    const savings = async () =>
      (await api(app).get('/api/savings').expect(200)).body as SavingsResponse;

    async function connectWithSavings() {
      await connect('Swedbank', 'session-1', [account(1, 'Lönekonto'), account(2, 'Sparkonto')]);
      await api(app).put('/api/accounts/2/savings').send({ savings: true }).expect(200);
      for (const [day, amount] of [
        ['2026-09-30', 1000],
        ['2026-10-31', 1500],
      ] as const) {
        db()
          .insert(balances)
          .values({
            accountId: 2,
            type: 'CLBD',
            amount,
            currency: 'SEK',
            fetchedAt: new Date(`${day}T10:00:00Z`),
          })
          .run();
      }
    }

    it('continues as one manual account with its history when the owner says so', async () => {
      await connectWithSavings();

      await remove('Swedbank', '2').expect(204);

      const view = await savings();
      expect(view.accounts).toHaveLength(1);
      const [only] = view.accounts;
      expect(only).toMatchObject({ kind: 'manual', name: 'Sparkonto', closedOn: null });
      expect(only!.balance).toBe(1500);
      expect(view.months.map((m) => [m.month, m.balance])).toEqual([
        ['2026-09', 1000],
        ['2026-10', 1500],
        ['2026-11', 1500],
      ]);
      await api(app)
        .post(`/api/manual-savings-accounts/${only!.manualId}/entries`)
        .send({ date: '2026-11-10', balance: 1600 })
        .expect(201);
      expect((await savings()).accounts[0]!.balance).toBe(1600);
    });

    it('closes it from the removal date when the owner declines', async () => {
      await connectWithSavings();

      await remove('Swedbank').expect(204);

      const [only] = (await savings()).accounts;
      expect(only).toMatchObject({ kind: 'connected', closedOn: '2026-11-10', balance: 0 });
    });

    it('stays manual when the bank is connected again', async () => {
      await connectWithSavings();
      await remove('Swedbank', '2').expect(204);

      await connect('Swedbank', 'session-2', [account(1, 'Lönekonto'), account(2, 'Sparkonto')]);

      expect((await savings()).accounts.map((a) => a.kind)).toEqual(['manual']);
    });

    it('refuses an account that is not a savings account of the bank', async () => {
      await connectWithSavings();

      await remove('Swedbank', '1').expect(400);

      expect((await list()).banks.map((group) => group.bank)).toEqual(['Swedbank']);
    });
  });
});
