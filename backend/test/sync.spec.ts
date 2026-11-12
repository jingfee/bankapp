import { Logger, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AccountsResponse, ConnectedAccount, TransactionDetails } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, balances, syncAccountResults, syncRuns, transactions } from '../src/db/schema';
import type {
  EnableBankingAccount,
  EnableBankingBalance,
  EnableBankingSession,
  EnableBankingTransaction,
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
  return { uid, identificationHash: `hash-${uid}`, name, type, currency: 'SEK', raw: '{}' };
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
    transactionDate: null,
    description: 'ICA',
    entryReference: null,
    raw: JSON.stringify({ amount }),
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
      await app.get(SyncService).start('manual').finished;

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

  describe('account details', () => {
    const details = (uid: string, name: string): EnableBankingAccount => ({
      ...account(uid, name),
      raw: JSON.stringify({ uid, product: name }),
    });
    const storedAccounts = () => db().select().from(accounts).orderBy(accounts.id).all();

    it('renames the account and stores the raw account from the bank', async () => {
      enableBanking.accountDetails.set('u1', details('u1', 'Lönekonto'));

      await connect('Swedbank', [account('u1', 'Anna Andersson')]);
      await settled();

      expect(storedAccounts()).toMatchObject([
        { name: 'Lönekonto', raw: JSON.stringify({ uid: 'u1', product: 'Lönekonto' }) },
      ]);
    });

    it('keeps the old name and still syncs when the details cannot be fetched', async () => {
      enableBanking.balances.set('u1', [balance('CLBD', 5)]);
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await connect('Swedbank', [account('u1', 'Anna Andersson')]);
      await settled();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not fetch details'));
      warn.mockRestore();

      expect(storedAccounts()).toMatchObject([{ name: 'Anna Andersson', raw: '{}' }]);
      expect(await accountNamed('Anna Andersson')).toMatchObject({ balance: { amount: 5 } });
      expect(db().select().from(syncAccountResults).all()).toMatchObject([{ outcome: 'ok' }]);
    });

    it('treats a rate limit on the details as a rate limit for the connection', async () => {
      enableBanking.rateLimitedDetails.add('u1');

      await connect('Swedbank', [
        account('u1', 'Lönekonto'),
        account('u2', 'Sparkonto', 'savings'),
      ]);
      await settled();

      expect(db().select().from(syncAccountResults).all()).toMatchObject([
        { accountId: 1, outcome: 'rate-limited' },
        { accountId: 2, outcome: 'rate-limited' },
      ]);
      expect(enableBanking.requestedDetails).toEqual(['u1']);
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
  describe('transactions', () => {
    const stored = () => db().select().from(transactions).orderBy(transactions.id).all();

    it('are stored with the parsed fields, a listing date and the raw response', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-125.5, {
          bookingDate: '2026-11-09',
          valueDate: '2026-11-08',
          transactionDate: '2026-11-07',
          description: 'ICA Maxi',
          entryReference: 'ref-1',
          raw: '{"original":true}',
        }),
      ]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      expect(stored()).toEqual([
        {
          id: 1,
          accountId: 1,
          status: 'booked',
          amount: -125.5,
          currency: 'SEK',
          bookingDate: '2026-11-09',
          valueDate: '2026-11-08',
          transactionDate: '2026-11-07',
          date: '2026-11-07',
          description: 'ICA Maxi',
          entryReference: 'ref-1',
          dedupKey: 'ref:ref-1',
          raw: '{"original":true}',
          fetchedAt: START,
          // Guessed from the merchant keywords.
          subcategoryId: expect.any(Number) as number,
          categoryConfirmed: false,
          categoryConfirmedAt: null,
          offsetsTransactionId: null,
        },
      ]);
    });

    it('are listed under the transaction date, else value date, else booking date, else the day they were fetched', async () => {
      const undated = { bookingDate: null, valueDate: null, transactionDate: null };
      enableBanking.transactions.set('u1', [
        transaction(-1, {
          ...undated,
          bookingDate: '2026-11-09',
          valueDate: '2026-11-08',
          transactionDate: '2026-11-07',
        }),
        transaction(-2, { ...undated, bookingDate: '2026-11-09', valueDate: '2026-11-08' }),
        transaction(-3, { ...undated, bookingDate: '2026-11-09' }),
        transaction(-4, { ...undated, status: 'pending', valueDate: '2026-11-06' }),
        transaction(-5, { ...undated, status: 'pending' }),
      ]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      expect(stored().map((row) => row.date)).toEqual([
        '2026-11-07',
        '2026-11-08',
        '2026-11-09',
        '2026-11-06',
        '2026-11-10',
      ]);
    });

    it('are listed newest first by their transaction date, not their booking date', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-1, {
          description: 'Bought earlier',
          bookingDate: '2026-11-09',
          transactionDate: '2026-11-03',
        }),
        transaction(-2, {
          description: 'Bought later',
          bookingDate: '2026-11-08',
          transactionDate: '2026-11-06',
        }),
      ]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      const body = (await request(app.getHttpServer()).get('/api/transactions').expect(200)).body;
      expect(
        body.transactions.map((t: { description: string; date: string }) => [
          t.description,
          t.date,
        ]),
      ).toEqual([
        ['Bought later', '2026-11-06'],
        ['Bought earlier', '2026-11-03'],
      ]);
    });

    it('stored before transaction dates were used are not stored again by the next sync', async () => {
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();
      // Written by the earlier version: no transaction date, fingerprint made from the booking date.
      db()
        .insert(transactions)
        .values({
          accountId: 1,
          status: 'booked',
          amount: -35,
          currency: 'SEK',
          bookingDate: '2026-11-09',
          valueDate: '2026-11-08',
          date: '2026-11-09',
          description: 'Espresso House',
          entryReference: null,
          dedupKey: 'fp:["2026-11-09",-35,"Espresso House"]:0',
          raw: '{}',
          fetchedAt: START,
        })
        .run();
      enableBanking.transactions.set('u1', [
        transaction(-35, {
          description: 'Espresso House',
          bookingDate: '2026-11-09',
          valueDate: '2026-11-08',
          transactionDate: '2026-11-07',
        }),
      ]);

      await app.get(SyncService).start('manual').finished;

      expect(stored()).toHaveLength(1);
    });

    it('are not stored twice when the next sync returns them again', async () => {
      enableBanking.transactions.set('u1', [transaction(-10, { entryReference: 'a' })]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      enableBanking.transactions.set('u1', [
        transaction(-10, { entryReference: 'a' }),
        transaction(-20, { entryReference: 'b' }),
      ]);
      await app.get(SyncService).start('manual').finished;

      expect(stored().map((row) => row.entryReference)).toEqual(['a', 'b']);
    });

    it('with the same entry reference on different accounts are both kept', async () => {
      enableBanking.transactions.set('u1', [transaction(-10, { entryReference: 'a' })]);
      enableBanking.transactions.set('u2', [transaction(-10, { entryReference: 'a' })]);

      await connect('Swedbank', [account('u1', 'Lönekonto'), account('u2', 'Sparkonto')]);
      await settled();

      expect(stored().map((row) => row.accountId)).toEqual([1, 2]);
    });

    it('without an entry reference are told apart by date, amount, description and occurrence', async () => {
      const coffee = transaction(-35, { description: 'Espresso House' });
      enableBanking.transactions.set('u1', [
        coffee,
        coffee,
        transaction(-35, { description: 'Espresso House', bookingDate: '2026-11-08' }),
        transaction(-36, { description: 'Espresso House' }),
      ]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();
      expect(stored()).toHaveLength(4);

      // The same history again, plus one more identical purchase.
      enableBanking.transactions.set('u1', [coffee, coffee, coffee]);
      await app.get(SyncService).start('manual').finished;

      expect(stored()).toHaveLength(5);
    });

    it('without an entry reference are not stored again when a pending twin books', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-35, { status: 'pending' }),
        transaction(-35),
      ]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      // The pending one has booked; the booked one is unchanged.
      enableBanking.transactions.set('u1', [transaction(-35), transaction(-35)]);
      await app.get(SyncService).start('manual').finished;

      expect(stored().filter((row) => row.status === 'booked')).toHaveLength(2);
    });

    it('that are pending are dropped when the bank also returns their booked twin', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-35, { status: 'pending', description: 'Espresso House' }),
        transaction(-35, { description: 'espresso house ' }),
        transaction(-35, { status: 'pending', description: 'Espresso House' }),
        transaction(-50, { status: 'pending', description: 'Espresso House' }),
      ]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      // One booked twin removes one reservation; the other two have no twin and stay.
      expect(stored().map((row) => [row.status, row.amount])).toEqual([
        ['booked', -35],
        ['pending', -35],
        ['pending', -50],
      ]);
    });

    it('that are pending match their booked twin whatever the case or punctuation of the description', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-129, { status: 'pending', description: 'Foo Bar Store' }),
        transaction(-129, { description: 'FOO.BAR STORE' }),
      ]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      expect(stored().map((row) => row.status)).toEqual(['booked']);
    });

    it('that are pending match their booked twin when the bank reserved it with the opposite sign', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-350, { status: 'pending', description: 'Fake.com' }),
        transaction(350, { description: 'FAKE.COM' }),
      ]);

      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      expect(stored().map((row) => [row.status, row.amount])).toEqual([['booked', 350]]);
    });

    it('that are pending keep their stored row across syncs while they stay pending', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-10, { status: 'pending', description: 'Cafe', entryReference: 'p1' }),
      ]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();
      const [first] = stored();

      enableBanking.transactions.set('u1', [
        transaction(-12, { status: 'pending', description: 'Cafe', entryReference: 'p1' }),
      ]);
      await app.get(SyncService).start('manual').finished;

      expect(stored()).toMatchObject([{ id: first!.id, status: 'pending', amount: -12 }]);
    });

    it('that are pending are updated in place when they book', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-10, { status: 'pending', description: 'Cafe', entryReference: 'p1' }),
      ]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();
      const [first] = stored();

      enableBanking.transactions.set('u1', [
        transaction(-10, { description: 'CAFE', entryReference: 'b1', bookingDate: '2026-11-11' }),
      ]);
      await app.get(SyncService).start('manual').finished;

      expect(stored()).toMatchObject([
        { id: first!.id, status: 'booked', description: 'CAFE', bookingDate: '2026-11-11' },
      ]);

      // Booked now, so it is not stored again by a later sync.
      await app.get(SyncService).start('manual').finished;
      expect(stored()).toHaveLength(1);
    });

    describe('that are pending with a category set by hand', () => {
      /** Sets Mat & Dryck / Café & fika on a transaction, as the owner would; returns its id. */
      async function categoriseByHand(id: number): Promise<number> {
        const body = (await request(app.getHttpServer()).get('/api/categories')).body as {
          categories: { name: string; subcategories: { id: number; name: string }[] }[];
        };
        const cafe = body.categories
          .find((c) => c.name === 'Mat & Dryck')!
          .subcategories.find((s) => s.name === 'Café & fika')!;
        await request(app.getHttpServer())
          .put(`/api/transactions/${id}/category`)
          .send({ subcategoryId: cafe.id })
          .expect(200);
        return cafe.id;
      }

      const categoryOf = async (id: number) =>
        (
          (await request(app.getHttpServer()).get(`/api/transactions/${id}`).expect(200))
            .body as TransactionDetails
        ).category;

      it('keep it across a sync and when they book', async () => {
        enableBanking.transactions.set('u1', [
          transaction(-10, { status: 'pending', description: 'Cafe', entryReference: 'p1' }),
        ]);
        await connect('Swedbank', [account('u1', 'Lönekonto')]);
        await settled();
        const [first] = stored();
        const cafe = await categoriseByHand(first!.id);

        await app.get(SyncService).start('manual').finished;
        expect(await categoryOf(first!.id)).toMatchObject({
          subcategory: { id: cafe },
          confirmed: true,
        });

        enableBanking.transactions.set('u1', [
          transaction(-10, {
            description: 'CAFE',
            entryReference: 'b1',
            bookingDate: '2026-11-11',
          }),
        ]);
        await app.get(SyncService).start('manual').finished;
        expect(stored()).toMatchObject([{ id: first!.id, status: 'booked' }]);
        expect(await categoryOf(first!.id)).toMatchObject({
          subcategory: { id: cafe },
          confirmed: true,
        });
      });

      it('keep it when the bank gives them no entry reference, across a sync and when they book', async () => {
        enableBanking.transactions.set('u1', [
          transaction(-10, { status: 'pending', description: 'Cafe', entryReference: null }),
        ]);
        await connect('Swedbank', [account('u1', 'Lönekonto')]);
        await settled();
        const cafe = await categoriseByHand(stored()[0]!.id);

        await app.get(SyncService).start('manual').finished;
        const [pending] = stored();
        expect(pending).toMatchObject({ status: 'pending', subcategoryId: cafe });
        expect(await categoryOf(pending!.id)).toMatchObject({ confirmed: true });

        enableBanking.transactions.set('u1', [
          transaction(-10, { description: 'CAFE', entryReference: 'b1' }),
        ]);
        await app.get(SyncService).start('manual').finished;
        const [booked] = stored();
        expect(stored()).toHaveLength(1);
        expect(booked).toMatchObject({ status: 'booked', subcategoryId: cafe });
        expect(await categoryOf(booked!.id)).toMatchObject({ confirmed: true });
      });

      it('hand it to their booked twin when that is already stored', async () => {
        enableBanking.transactions.set('u1', [
          transaction(-10, { status: 'pending', description: 'Cafe', entryReference: 'p1' }),
        ]);
        await connect('Swedbank', [account('u1', 'Lönekonto')]);
        await settled();
        const cafe = await categoriseByHand(stored()[0]!.id);
        // The booked twin got stored on its own, e.g. by a sync that did not recognise the pair.
        db()
          .insert(transactions)
          .values({
            accountId: stored()[0]!.accountId,
            status: 'booked',
            amount: -10,
            currency: 'SEK',
            date: '2026-11-09',
            description: 'Cafe',
            entryReference: 'b1',
            dedupKey: 'ref:b1',
            raw: '{}',
            fetchedAt: START,
          })
          .run();

        enableBanking.transactions.set('u1', [
          transaction(-10, { description: 'Cafe', entryReference: 'b1' }),
        ]);
        await app.get(SyncService).start('manual').finished;

        expect(stored()).toMatchObject([
          { status: 'booked', subcategoryId: cafe, categoryConfirmed: true },
        ]);
      });
    });

    it('that are pending are updated in place when they book after the bank stopped returning them', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-10, { status: 'pending', description: 'Cafe', entryReference: 'p1' }),
      ]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();
      const [first] = stored();

      enableBanking.transactions.set('u1', [
        transaction(-10, { description: 'Cafe', entryReference: 'b1' }),
      ]);
      await app.get(SyncService).start('manual').finished;

      expect(stored()).toMatchObject([{ id: first!.id, status: 'booked' }]);
    });

    it('that are pending are removed when the bank stops returning them without a booked match', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-10, { status: 'pending', description: 'Cafe', entryReference: 'p1' }),
        transaction(-20, { status: 'pending', description: 'Kiosk', entryReference: 'p2' }),
      ]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      enableBanking.transactions.set('u1', [
        transaction(-20, { status: 'pending', description: 'Kiosk', entryReference: 'p2' }),
      ]);
      await app.get(SyncService).start('manual').finished;

      expect(stored().map((row) => row.description)).toEqual(['Kiosk']);
    });

    it('that are booked are never deleted when the bank stops returning them', async () => {
      enableBanking.transactions.set('u1', [transaction(-10, { entryReference: 'a' })]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      enableBanking.transactions.set('u1', []);
      await app.get(SyncService).start('manual').finished;

      expect(stored()).toHaveLength(1);
    });

    it('that are pending are replaced on each sync', async () => {
      enableBanking.transactions.set('u1', [
        transaction(-10, { status: 'pending', description: 'Reserved A' }),
        transaction(-20, { status: 'pending', description: 'Reserved B' }),
      ]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();
      expect(stored()).toHaveLength(2);

      // A is now booked, B is gone and C is new.
      enableBanking.transactions.set('u1', [
        transaction(-10, { description: 'Booked A', entryReference: 'a' }),
        transaction(-30, { status: 'pending', description: 'Reserved C' }),
      ]);
      await app.get(SyncService).start('manual').finished;

      expect(stored().map((row) => [row.status, row.description])).toEqual([
        ['booked', 'Booked A'],
        ['pending', 'Reserved C'],
      ]);
    });

    it('of one account are not affected by another account being synced', async () => {
      enableBanking.transactions.set('u1', [transaction(-10, { status: 'pending' })]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      enableBanking.transactions.set('u2', []);
      await connect('Coop Mastercard', [account('u2', 'Kort', 'card')]);
      await settled();

      expect(stored()).toHaveLength(1);
    });

    it('are kept as they were, along with the balances, when the bank refuses the next fetch', async () => {
      enableBanking.transactions.set('u1', [transaction(-10, { status: 'pending' })]);
      await connect('Swedbank', [account('u1', 'Lönekonto')]);
      await settled();

      enableBanking.failingTransactions.add('u1');
      enableBanking.balances.set('u1', [balance('CLBD', 5)]);
      await app.get(SyncService).start('manual').finished;

      expect(stored()).toHaveLength(1);
      expect(db().select().from(balances).all()).toEqual([]);
      expect(db().select().from(syncAccountResults).all()).toMatchObject([
        { outcome: 'ok' },
        { outcome: 'failed' },
      ]);
    });
  });
});
