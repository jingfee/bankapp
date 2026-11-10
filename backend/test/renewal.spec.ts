import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AccountsResponse, BankAccounts } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections, syncRuns, transactions } from '../src/db/schema';
import type {
  EnableBankingAccount,
  EnableBankingSession,
} from '../src/enable-banking/enable-banking-client';
import { createApp } from '../src/app';
import { bank, FakeEnableBankingClient, testConfig } from './support';

const START = new Date('2026-11-10T12:00:00.000Z');
const DAY = 24 * 3600 * 1000;

const lonekonto: EnableBankingAccount = {
  uid: 'uid-1',
  identificationHash: 'hash-1',
  name: 'Lönekonto',
  type: 'payment',
  currency: 'SEK',
};
const sparkonto: EnableBankingAccount = {
  uid: 'uid-2',
  identificationHash: 'hash-2',
  name: 'Sparkonto',
  type: 'savings',
  currency: 'SEK',
};

describe('connection expiry and renewal', () => {
  let app: INestApplication;
  let enableBanking: FakeEnableBankingClient;
  let now: Date;

  beforeEach(() => {
    enableBanking = new FakeEnableBankingClient();
    enableBanking.banks = [bank('Swedbank')];
    now = START;
  });

  afterEach(() => app.close());

  async function start(): Promise<void> {
    app = await createApp({
      config: testConfig,
      enableBanking,
      database: { inMemory: true },
      now: () => now,
    });
    await app.init();
  }

  const db = () => app.get<AppDatabase>(DATABASE);

  async function connect(session: EnableBankingSession): Promise<void> {
    enableBanking.session = session;
    await request(app.getHttpServer()).post('/api/connections').send({ bank: 'Swedbank' });
    const state = enableBanking.authorisations.at(-1)!.state;
    await request(app.getHttpServer())
      .get('/api/connections/callback')
      .query({ code: `code-${enableBanking.authorisations.length}`, state })
      .expect(302);
    await settle();
  }

  /** Lets the initial sync that follows a connection finish. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const { body } = await request(app.getHttpServer()).get('/api/accounts');
      if (!(body as AccountsResponse).syncing) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  const overview = async (): Promise<BankAccounts> =>
    ((await request(app.getHttpServer()).get('/api/accounts').expect(200)).body as AccountsResponse)
      .banks[0]!;

  const session = (
    validUntil: Date,
    list: EnableBankingAccount[] = [lonekonto, sparkonto],
    sessionId = 'session-1',
  ): EnableBankingSession => ({ sessionId, validUntil, accounts: list });

  const startRenewal = () =>
    request(app.getHttpServer()).post('/api/connections').send({ bank: 'Swedbank' });

  describe('status', () => {
    it.each([
      ['more than 14 days away', 14 * DAY + 1, 'active'],
      ['exactly 14 days away', 14 * DAY, 'expiring'],
      ['a day away', DAY, 'expiring'],
      ['right now', 0, 'expired'],
      ['in the past', -DAY, 'expired'],
    ] as const)('is computed when the connection ends %s', async (_name, offset, status) => {
      await start();
      await connect(session(new Date(START.getTime() + offset)));

      expect(await overview()).toMatchObject({
        status,
        validUntil: new Date(START.getTime() + offset).toISOString(),
      });
    });

    it('changes as time passes', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 30 * DAY)));
      expect((await overview()).status).toBe('active');

      now = new Date(START.getTime() + 20 * DAY);
      expect((await overview()).status).toBe('expiring');

      now = new Date(START.getTime() + 31 * DAY);
      expect((await overview()).status).toBe('expired');
    });
  });

  describe('syncing', () => {
    it('skips the accounts of an expired connection', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 30 * DAY)));
      enableBanking.requestedBalances = [];
      now = new Date(START.getTime() + 31 * DAY);

      await request(app.getHttpServer()).post('/api/sync').expect(202);
      await settle();

      expect(enableBanking.requestedBalances).toEqual([]);
    });
  });

  describe('renewing', () => {
    const FUTURE = new Date(START.getTime() + 90 * DAY);

    it('is refused while the connection is neither expiring nor expired', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 30 * DAY)));

      await startRenewal().expect(409);
    });

    it.each([
      ['expiring', 10 * DAY],
      ['expired', -DAY],
    ])('is allowed for an %s connection', async (_name, offset) => {
      await start();
      await connect(session(new Date(START.getTime() + offset)));

      await startRenewal().expect(201);

      expect(enableBanking.authorisations).toHaveLength(2);
    });

    async function renew(renewed: EnableBankingSession): Promise<string> {
      enableBanking.session = renewed;
      await startRenewal().expect(201);
      const state = enableBanking.authorisations.at(-1)!.state;
      const response = await request(app.getHttpServer())
        .get('/api/connections/callback')
        .query({ code: 'renew-code', state })
        .expect(302);
      await settle();
      return response.headers['location'] as string;
    }

    it('renews the same connection in place and lands on the success page', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 5 * DAY)));
      const [before] = db().select().from(connections).all();

      const location = await renew(session(FUTURE, [lonekonto, sparkonto], 'session-2'));

      expect(location).toBe('/anslut-bank/resultat?status=ok&bank=Swedbank');
      expect(db().select().from(connections).all()).toEqual([
        { ...before, sessionId: 'session-2', validUntil: FUTURE },
      ]);
      expect(await overview()).toMatchObject({ status: 'active' });
    });

    it('matches accounts by identification hash and gives them their new uid', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 5 * DAY)));
      const idsBefore = db().select({ id: accounts.id }).from(accounts).all();

      await renew(
        session(FUTURE, [
          { ...lonekonto, uid: 'new-uid-1', name: 'Lönekonto (nytt namn)' },
          { ...sparkonto, uid: 'new-uid-2' },
        ]),
      );

      const rows = db().select().from(accounts).all();
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.id)).toEqual(idsBefore.map((row) => row.id));
      expect(rows.map((row) => [row.identificationHash, row.uid, row.name, row.closed])).toEqual([
        ['hash-1', 'new-uid-1', 'Lönekonto (nytt namn)', false],
        ['hash-2', 'new-uid-2', 'Sparkonto', false],
      ]);
    });

    it('keeps the history of renewed accounts', async () => {
      await start();
      enableBanking.transactions.set('uid-1', [
        {
          status: 'booked',
          amount: -50,
          currency: 'SEK',
          bookingDate: '2026-11-01',
          valueDate: null,
          description: 'ICA',
          entryReference: 'ref-1',
          raw: '{}',
        },
      ]);
      await connect(session(new Date(START.getTime() + 5 * DAY)));
      expect(db().select().from(transactions).all()).toHaveLength(1);

      await renew(session(FUTURE, [{ ...lonekonto, uid: 'new-uid-1' }, sparkonto]));

      expect(db().select().from(transactions).all()).toHaveLength(1);
    });

    it('adds accounts the renewal returns that were not there before', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 5 * DAY), [lonekonto]));

      await renew(session(FUTURE, [lonekonto, sparkonto]));

      expect((await overview()).accounts.map((account) => account.name)).toEqual([
        'Lönekonto',
        'Sparkonto',
      ]);
    });

    it('marks accounts the renewal no longer returns as closed and shows them apart', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 5 * DAY)));

      await renew(session(FUTURE, [lonekonto]));

      const shown = await overview();
      expect(shown.accounts.map((account) => account.name)).toEqual(['Lönekonto']);
      expect(shown.closedAccounts.map((account) => account.name)).toEqual(['Sparkonto']);
      expect(
        db()
          .select({ name: accounts.name, closed: accounts.closed })
          .from(accounts)
          .all()
          .sort((a, b) => a.name.localeCompare(b.name)),
      ).toEqual([
        { name: 'Lönekonto', closed: false },
        { name: 'Sparkonto', closed: true },
      ]);
    });

    it('does not sync closed accounts, and reopens one that comes back', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 5 * DAY)));
      await renew(session(FUTURE, [lonekonto]));
      enableBanking.requestedBalances = [];

      await request(app.getHttpServer()).post('/api/sync').expect(202);
      await settle();
      expect(enableBanking.requestedBalances).toEqual(['uid-1']);

      now = new Date(FUTURE.getTime() - 5 * DAY);
      await renew(session(new Date(FUTURE.getTime() + 90 * DAY), [lonekonto, sparkonto]));
      expect((await overview()).closedAccounts).toEqual([]);
    });

    it('runs an initial sync of the renewed connection afterwards', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 5 * DAY)));
      enableBanking.requestedBalances = [];
      enableBanking.transactionOptions = [];

      await renew(session(FUTURE, [{ ...lonekonto, uid: 'new-uid-1' }]));

      expect(db().select().from(syncRuns).all().at(-1)?.trigger).toBe('initial');
      expect(enableBanking.requestedBalances).toEqual(['new-uid-1']);
      expect(enableBanking.transactionOptions).toEqual([{}]);
    });

    it('keeps the old connection when the renewal fails', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 5 * DAY)));
      await startRenewal().expect(201);
      enableBanking.session = undefined;

      const response = await request(app.getHttpServer())
        .get('/api/connections/callback')
        .query({ code: 'bad', state: enableBanking.authorisations.at(-1)!.state })
        .expect(302);

      expect(response.headers['location']).toBe('/anslut-bank/resultat?status=fel');
      expect(db().select().from(connections).all()[0]!.sessionId).toBe('session-1');
      expect((await overview()).closedAccounts).toEqual([]);
    });

    it('a second login finished after the first renewal is reported as already connected', async () => {
      await start();
      await connect(session(new Date(START.getTime() + 5 * DAY)));
      await startRenewal().expect(201);
      const first = enableBanking.authorisations.at(-1)!.state;
      await startRenewal().expect(201);
      const second = enableBanking.authorisations.at(-1)!.state;
      enableBanking.session = session(FUTURE);
      await request(app.getHttpServer())
        .get('/api/connections/callback')
        .query({ code: 'c1', state: first })
        .expect(302);

      const response = await request(app.getHttpServer())
        .get('/api/connections/callback')
        .query({ code: 'c2', state: second })
        .expect(302);

      expect(response.headers['location']).toBe('/anslut-bank/resultat?status=redan&bank=Swedbank');
      expect(enableBanking.redeemedCodes).toHaveLength(2);
    });
  });
});
