import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AccountsResponse } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { syncRuns } from '../src/db/schema';
import type {
  EnableBankingAccount,
  EnableBankingSession,
  EnableBankingTransaction,
} from '../src/enable-banking/enable-banking-client';
import { createApp } from '../src/app';
import { bank, FakeEnableBankingClient, testConfig } from './support';

const START = new Date('2026-11-10T12:00:00.000Z');
const USER_AGENT = 'Mozilla/5.0 (Pixel)';

function account(uid: string, name: string): EnableBankingAccount {
  return { uid, identificationHash: `hash-${uid}`, name, type: 'payment', currency: 'SEK' };
}

function transaction(
  amount: number,
  overrides: Partial<EnableBankingTransaction> = {},
): EnableBankingTransaction {
  return {
    status: 'booked',
    amount,
    currency: 'SEK',
    bookingDate: '2026-11-09',
    valueDate: '2026-11-09',
    description: 'ICA',
    entryReference: `ref-${amount}`,
    raw: JSON.stringify({ amount }),
    ...overrides,
  };
}

describe('the manual sync', () => {
  let app: INestApplication;
  let enableBanking: FakeEnableBankingClient;
  let now: Date;

  beforeEach(async () => {
    enableBanking = new FakeEnableBankingClient();
    enableBanking.banks = [bank('Swedbank'), bank('Coop Mastercard')];
    now = START;
    app = await createApp({
      config: testConfig,
      enableBanking,
      database: { inMemory: true },
      now: () => now,
    });
    await app.init();
  });

  afterEach(() => app.close());

  const getAccounts = async (): Promise<AccountsResponse> =>
    (await request(app.getHttpServer()).get('/api/accounts').expect(200)).body;

  const settled = () =>
    vi.waitFor(async () => expect((await getAccounts()).syncing).toBe(false), { timeout: 2000 });

  async function connect(
    bankName: string,
    accounts: EnableBankingAccount[],
    validUntil = new Date('2027-02-08T12:00:00.000Z'),
  ): Promise<void> {
    const session: EnableBankingSession = {
      sessionId: `session-${bankName}`,
      validUntil,
      accounts,
    };
    enableBanking.session = session;
    await request(app.getHttpServer()).post('/api/connections').send({ bank: bankName });
    const { state } = enableBanking.authorisations.at(-1)!;
    await request(app.getHttpServer())
      .get('/api/connections/callback')
      .query({ code: 'the-code', state })
      .expect(302);
    await settled();
  }

  const startManualSync = () =>
    request(app.getHttpServer()).post('/api/sync').set('User-Agent', USER_AGENT);

  const runs = () => app.get<AppDatabase>(DATABASE).select().from(syncRuns).all();

  it('syncs every account of every active connection and reports what it found', async () => {
    await connect('Swedbank', [account('u1', 'Lönekonto'), account('u2', 'Sparkonto')]);
    await connect('Coop Mastercard', [account('u3', 'Kort')]);
    enableBanking.requestedBalances = [];
    enableBanking.transactions.set('u1', [transaction(-10), transaction(-20)]);
    enableBanking.transactions.set('u3', [transaction(-30)]);

    const response = await startManualSync().expect(202);
    await settled();

    expect(response.body).toEqual({ started: true });
    expect(enableBanking.requestedBalances).toEqual(['u1', 'u2', 'u3']);
    expect((await getAccounts()).lastSync).toEqual({
      finishedAt: START.toISOString(),
      newTransactions: 3,
      failedAccounts: 0,
      rateLimited: false,
    });
  });

  it('does not sync a connection that has expired', async () => {
    await connect('Swedbank', [account('u1', 'Lönekonto')], new Date('2026-11-01T00:00:00.000Z'));
    enableBanking.requestedBalances = [];

    await startManualSync().expect(202);
    await settled();

    expect(enableBanking.requestedBalances).toEqual([]);
  });

  it('counts only transactions that were not stored before', async () => {
    await connect('Swedbank', [account('u1', 'Lönekonto')]);
    enableBanking.transactions.set('u1', [transaction(-10)]);
    await startManualSync().expect(202);
    await settled();

    enableBanking.transactions.set('u1', [transaction(-10), transaction(-20)]);
    await startManualSync().expect(202);
    await settled();

    expect((await getAccounts()).lastSync?.newTransactions).toBe(1);
  });

  describe('on behalf of the owner', () => {
    it('sends the owner’s request details to the bank; other syncs send none', async () => {
      await connect('Swedbank', [account('u1', 'Lönekonto')]);

      await startManualSync().expect(202);
      await settled();

      // The first requests belong to the initial sync, the last ones to the manual sync.
      expect(enableBanking.balanceOptions[0]).toBeUndefined();
      expect(enableBanking.transactionOptions[0]?.psu).toBeUndefined();
      const psu = { ipAddress: expect.stringMatching(/127\.0\.0\.1$/), userAgent: USER_AGENT };
      expect(enableBanking.balanceOptions.at(-1)).toEqual({ psu });
      expect(enableBanking.transactionOptions.at(-1)).toMatchObject({ psu });
    });
  });

  describe('which transactions it asks for', () => {
    it('reaches back as far as the bank allows when nothing is stored yet', async () => {
      await connect('Swedbank', [account('u1', 'Lönekonto')]);

      await startManualSync().expect(202);
      await settled();

      expect(enableBanking.transactionOptions.at(-1)?.dateFrom).toBeUndefined();
    });

    it('starts a week before the last booked transaction, to catch pending ones that book', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-1, { bookingDate: '2026-11-02' }),
        transaction(-2, { bookingDate: '2026-11-09' }),
        transaction(-3, { status: 'pending', bookingDate: null, valueDate: '2026-11-10' }),
      ]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);

      await startManualSync().expect(202);
      await settled();

      expect(enableBanking.transactionOptions.at(-1)?.dateFrom).toBe('2026-11-02');
    });
  });

  describe('while another sync is running', () => {
    it('does not start a second one', async () => {
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      let release!: () => void;
      enableBanking.holdBalances = new Promise((resolve) => (release = resolve));
      enableBanking.requestedBalances = [];

      const first = await startManualSync().expect(202);
      const second = await startManualSync().expect(202);
      release();
      await settled();

      expect(first.body).toEqual({ started: true });
      expect(second.body).toEqual({ started: false });
      expect(runs()).toHaveLength(2); // the initial sync and the first manual one
      expect(enableBanking.requestedBalances).toEqual(['u1']);
    });
  });

  describe('when one account fails', () => {
    it('records it and still syncs the other accounts', async () => {
      await connect('Swedbank', [account('u1', 'Lönekonto'), account('u2', 'Sparkonto')]);
      enableBanking.failingBalances.add('u1');
      enableBanking.transactions.set('u2', [transaction(-5)]);

      await startManualSync().expect(202);
      await settled();

      expect((await getAccounts()).lastSync).toMatchObject({
        newTransactions: 1,
        failedAccounts: 1,
        rateLimited: false,
      });
    });
  });

  describe('when the bank says it was asked too often', () => {
    it('keeps the existing data, skips the bank’s other accounts and reports the rate limit', async () => {
      enableBanking.transactions.set('u1', [transaction(-10)]);
      await connect('Swedbank', [account('u1', 'Lönekonto'), account('u2', 'Sparkonto')]);
      await connect('Coop Mastercard', [account('u3', 'Kort')]);
      const before = await getAccounts();
      now = new Date(START.getTime() + 3600_000);
      enableBanking.rateLimited.add('u1');
      enableBanking.requestedBalances = [];

      await startManualSync().expect(202);
      await settled();
      const after = await getAccounts();

      expect(after.lastSync).toMatchObject({ rateLimited: true, failedAccounts: 0 });
      // Swedbank's second account is not asked once the bank has refused; Coop still is.
      expect(enableBanking.requestedBalances).toEqual(['u1', 'u3']);
      const swedbank = (accounts: AccountsResponse) =>
        accounts.banks.find((group) => group.bank === 'Swedbank')!.accounts[0]!;
      expect(swedbank(after)).toEqual(swedbank(before));
      expect(swedbank(after).lastSyncedAt).toBe(START.toISOString());
    });
  });

  it('has no summary before any sync has finished', async () => {
    expect((await getAccounts()).lastSync).toBeNull();
  });
});
