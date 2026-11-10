import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AccountsResponse, ConnectedAccount } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { balances, syncAccountResults, syncRuns } from '../src/db/schema';
import type {
  EnableBankingAccount,
  EnableBankingBalance,
  EnableBankingSession,
} from '../src/enable-banking/enable-banking-client';
import { createApp } from '../src/app';
import { SyncService } from '../src/sync/sync.service';
import { bank, FakeEnableBankingClient, testConfig } from './support';

const START = new Date('2026-11-10T12:00:00.000Z');

function account(
  uid: string,
  name: string,
  type: EnableBankingAccount['type'] = 'payment',
): EnableBankingAccount {
  return { uid, identificationHash: `hash-${uid}`, name, type, currency: 'SEK' };
}

function balance(
  type: string,
  amount: number,
  overrides: Partial<EnableBankingBalance> = {},
): EnableBankingBalance {
  return {
    type,
    amount,
    currency: 'SEK',
    referenceDate: '2026-11-09',
    creditDebit: null,
    ...overrides,
  };
}

describe('the initial sync', () => {
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

  /** Connects a bank through the HTTP API, as the owner returning from BankID would. */
  async function connect(bankName: string, accounts: EnableBankingAccount[]): Promise<void> {
    const session: EnableBankingSession = {
      sessionId: `session-${bankName}`,
      validUntil: new Date('2027-02-08T12:00:00.000Z'),
      accounts,
    };
    enableBanking.session = session;
    await request(app.getHttpServer()).post('/api/connections').send({ bank: bankName });
    const { state } = enableBanking.authorisations.at(-1)!;
    await request(app.getHttpServer())
      .get('/api/connections/callback')
      .query({ code: 'the-code', state })
      .expect(302);
  }

  const accountNamed = async (name: string): Promise<ConnectedAccount> =>
    (await getAccounts()).banks.flatMap((group) => group.accounts).find((a) => a.name === name)!;

  const db = () => app.get<AppDatabase>(DATABASE);

  it('starts by itself when a connection is created and shows the balances afterwards', async () => {
    enableBanking.balances.set('u1', [balance('CLBD', -1234.5), balance('ITAV', 5000)]);
    now = START;

    await connect('Swedbank', [account('u1', 'Lönekonto')]);
    await settled();

    expect(enableBanking.requestedBalances).toEqual(['u1']);
    expect(await accountNamed('Lönekonto')).toMatchObject({
      balance: { amount: -1234.5, currency: 'SEK' },
      lastSyncedAt: START.toISOString(),
    });
  });

  it('shows a sync in progress until it has finished', async () => {
    let release!: () => void;
    enableBanking.holdBalances = new Promise((resolve) => (release = resolve));
    enableBanking.balances.set('u1', [balance('CLBD', 100)]);

    await connect('Swedbank', [account('u1', 'Lönekonto')]);

    const during = await getAccounts();
    expect(during.syncing).toBe(true);
    expect(during.banks[0]!.accounts[0]).toMatchObject({ balance: null, lastSyncedAt: null });

    release();
    await settled();
    expect((await accountNamed('Lönekonto')).balance).toEqual({ amount: 100, currency: 'SEK' });
  });

  it('stores every balance type with its reference date and fetch time', async () => {
    enableBanking.balances.set('u1', [
      balance('CLBD', 100, { referenceDate: '2026-11-09' }),
      balance('ITAV', 250.5, { referenceDate: null }),
    ]);

    await connect('Swedbank', [account('u1', 'Lönekonto')]);
    await settled();

    expect(
      db()
        .select()
        .from(balances)
        .all()
        .map(({ type, amount, currency, referenceDate, fetchedAt }) => ({
          type,
          amount,
          currency,
          referenceDate,
          fetchedAt,
        })),
    ).toEqual([
      { type: 'CLBD', amount: 100, currency: 'SEK', referenceDate: '2026-11-09', fetchedAt: START },
      { type: 'ITAV', amount: 250.5, currency: 'SEK', referenceDate: null, fetchedAt: START },
    ]);
  });

  describe('the balance shown for an account', () => {
    it('prefers the booked closing balance', async () => {
      enableBanking.balances.set('u1', [
        balance('ITAV', 900),
        balance('ITBD', 800),
        balance('CLBD', 700),
      ]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      expect((await accountNamed('Lönekonto')).balance?.amount).toBe(700);
    });

    it('falls back to another balance when the bank has no booked closing balance', async () => {
      enableBanking.balances.set('u1', [balance('ITAV', 900), balance('ITBD', 800)]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      expect((await accountNamed('Lönekonto')).balance?.amount).toBe(800);
    });

    it('comes from the latest fetch, not from an older one with a preferred type', async () => {
      enableBanking.balances.set('u1', [balance('CLBD', 1000)]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      // A later fetch (the next sync) in which the bank no longer reports the closing balance.
      enableBanking.balances.set('u1', [balance('ITAV', 900)]);
      now = new Date(START.getTime() + 3600_000);
      await app.get(SyncService).start('manual');

      expect((await accountNamed('Lönekonto')).balance?.amount).toBe(900);
    });

    it('is empty when the bank reports no balances', async () => {
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      expect(await accountNamed('Lönekonto')).toMatchObject({
        balance: null,
        lastSyncedAt: START.toISOString(),
      });
    });
  });

  describe('card accounts', () => {
    it('are negative when money is owed, however the bank signs the amount', async () => {
      enableBanking.balances.set('card-debit', [balance('CLBD', 3200, { creditDebit: 'debit' })]);
      enableBanking.balances.set('card-negative', [
        balance('CLBD', -450, { creditDebit: 'debit' }),
      ]);

      await connect('Coop Mastercard', [
        account('card-debit', 'Kort A', 'card'),
        account('card-negative', 'Kort B', 'card'),
      ]);
      await settled();

      expect((await accountNamed('Kort A')).balance?.amount).toBe(-3200);
      expect((await accountNamed('Kort B')).balance?.amount).toBe(-450);
    });

    it('are positive when the bank owes the owner', async () => {
      enableBanking.balances.set('u1', [balance('CLBD', 120, { creditDebit: 'credit' })]);

      await connect('Coop Mastercard', [account('u1', 'Kort', 'card')]);
      await settled();

      expect((await accountNamed('Kort')).balance?.amount).toBe(120);
    });

    it('keep the amount as reported when the bank gives no credit/debit indicator', async () => {
      enableBanking.balances.set('u1', [balance('CLBD', -75)]);

      await connect('Coop Mastercard', [account('u1', 'Kort', 'card')]);
      await settled();

      expect((await accountNamed('Kort')).balance?.amount).toBe(-75);
    });

    it('do not change the sign of other account types', async () => {
      enableBanking.balances.set('u1', [balance('CLBD', 500, { creditDebit: 'debit' })]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      expect((await accountNamed('Lönekonto')).balance?.amount).toBe(500);
    });
  });

  describe('when the bank refuses one account', () => {
    beforeEach(async () => {
      enableBanking.failingBalances.add('u1');
      enableBanking.balances.set('u2', [balance('CLBD', 42)]);
      await connect('Swedbank', [
        account('u1', 'Lönekonto'),
        account('u2', 'Sparkonto', 'savings'),
      ]);
      await settled();
    });

    it('still syncs the other accounts', async () => {
      expect(await accountNamed('Lönekonto')).toMatchObject({ balance: null, lastSyncedAt: null });
      expect(await accountNamed('Sparkonto')).toMatchObject({
        balance: { amount: 42, currency: 'SEK' },
        lastSyncedAt: START.toISOString(),
      });
    });

    it('records the outcome per account', () => {
      const results = db()
        .select()
        .from(syncAccountResults)
        .all()
        .map(({ accountId, outcome, error }) => ({ accountId, outcome, failed: error !== null }));
      expect(results).toEqual([
        { accountId: 1, outcome: 'failed', failed: true },
        { accountId: 2, outcome: 'ok', failed: false },
      ]);
    });
  });

  it('records the run with its trigger and start and end time', async () => {
    enableBanking.balances.set('u1', [balance('CLBD', 1)]);

    await connect('Swedbank', [account('u1', 'Lönekonto')]);
    await settled();

    expect(db().select().from(syncRuns).all()).toEqual([
      { id: 1, trigger: 'initial', startedAt: START, finishedAt: START },
    ]);
    expect(db().select().from(syncAccountResults).all()).toMatchObject([
      { syncRunId: 1, accountId: 1, outcome: 'ok', error: null, syncedAt: START },
    ]);
  });

  it('only syncs the accounts of the new connection', async () => {
    await connect('Swedbank', [account('u1', 'Lönekonto')]);
    await settled();

    await connect('Coop Mastercard', [account('u2', 'Kort', 'card')]);
    await settled();

    expect(enableBanking.requestedBalances).toEqual(['u1', 'u2']);
  });

  it('does not start when no connection was created', async () => {
    await request(app.getHttpServer())
      .get('/api/connections/callback')
      .query({ state: 'made-up', code: 'c' })
      .expect(400);

    expect((await getAccounts()).syncing).toBe(false);
    expect(db().select().from(syncRuns).all()).toEqual([]);
  });
});
