import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AccountsResponse, StartConnectionResponse } from '@bankapp/shared';
import { DATABASE } from '../src/db/database.module';
import type { AppDatabase } from '../src/db/database';
import { accounts, connections } from '../src/db/schema';
import type { EnableBankingSession } from '../src/enable-banking/enable-banking-client';
import { createApp } from '../src/app';
import { bank, FakeEnableBankingClient, testConfig } from './support';

const START = new Date('2026-11-10T12:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 3600;

describe('connecting a bank', () => {
  let app: INestApplication;
  let enableBanking: FakeEnableBankingClient;
  let now: Date;

  beforeEach(() => {
    enableBanking = new FakeEnableBankingClient();
    now = START;
  });

  afterEach(() => app.close());

  async function start(config = testConfig): Promise<void> {
    app = await createApp({
      config,
      enableBanking,
      database: { inMemory: true },
      now: () => now,
    });
    await app.init();
  }

  const startConnection = (bankName: string) =>
    request(app.getHttpServer()).post('/api/connections').send({ bank: bankName });

  describe('starting', () => {
    it('requests the maximum consent the bank allows and returns its authorisation URL', async () => {
      enableBanking.banks = [bank('Swedbank', { maximumConsentSeconds: 180 * DAY })];
      await start();

      const response = await startConnection('Swedbank').expect(201);

      expect((response.body as StartConnectionResponse).url).toBe(
        'https://bankid.example/auth?bank=Swedbank',
      );
      expect(enableBanking.authorisations).toHaveLength(1);
      expect(enableBanking.authorisations[0]).toMatchObject({
        bank: 'Swedbank',
        country: 'SE',
        // A minute short of the maximum, so the request is not over it by the time the bank checks.
        validUntil: new Date(START.getTime() + 180 * DAY * 1000 - MINUTE),
        redirectUrl: testConfig.redirectUrl,
      });
      expect(enableBanking.authorisations[0]!.state).toMatch(/^[\w-]{20,}$/);
    });

    it('answers 502 and keeps no login when Enable Banking refuses to start one', async () => {
      enableBanking.banks = [bank('Skandia')];
      enableBanking.failAuthorisationWith = new Error('Enable Banking answered 400 for POST /auth');
      await start();

      await startConnection('Skandia').expect(502);

      // The login was never handed out, so no callback can complete it.
      const state = enableBanking.authorisations[0]!.state;
      await callback({ state, code: 'code-1' }).expect(400);
    });
  });

  const SESSION_VALID_UNTIL = new Date('2027-02-08T12:00:00.000Z');
  const session: EnableBankingSession = {
    sessionId: 'session-1',
    validUntil: SESSION_VALID_UNTIL,
    accounts: [
      {
        uid: 'uid-2',
        identificationHash: 'hash-2',
        name: 'Sparkonto',
        type: 'savings',
        currency: 'SEK',
        raw: '{"uid":"uid-2"}',
      },
      {
        uid: 'uid-1',
        identificationHash: 'hash-1',
        name: 'Lönekonto',
        type: 'payment',
        currency: 'SEK',
        raw: '{"uid":"uid-1"}',
      },
    ],
  };

  /** The overview without balances and sync times, which sync.spec.ts covers. */
  const getAccounts = async (): Promise<{
    banks: { bank: string; accounts: { name: string; type: string }[] }[];
  }> => {
    const { banks }: AccountsResponse = (
      await request(app.getHttpServer()).get('/api/accounts').expect(200)
    ).body;
    return {
      banks: banks.map(({ bank, accounts }) => ({
        bank,
        accounts: accounts.map(({ name, type }) => ({ name, type })),
      })),
    };
  };

  /** Starts a connection and returns the state the bank will echo back on the redirect. */
  async function begin(bankName: string): Promise<string> {
    await startConnection(bankName).expect(201);
    return enableBanking.authorisations.at(-1)!.state;
  }

  const callback = (query: Record<string, string>) =>
    request(app.getHttpServer()).get('/api/connections/callback').query(query);

  describe('returning from BankID', () => {
    it('stores the connection and its accounts and lands on the success page', async () => {
      enableBanking.banks = [bank('Swedbank')];
      enableBanking.session = session;
      await start();
      const state = await begin('Swedbank');

      const response = await callback({ code: 'the-code', state }).expect(302);

      expect(response.headers['location']).toBe('/anslut-bank/resultat?status=ok&bank=Swedbank');
      expect(enableBanking.redeemedCodes).toEqual(['the-code']);
      expect(await getAccounts()).toEqual({
        banks: [
          {
            bank: 'Swedbank',
            accounts: [
              { name: 'Lönekonto', type: 'payment' },
              { name: 'Sparkonto', type: 'savings' },
            ],
          },
        ],
      });
      // Nothing in the API exposes these yet, so look at the stored rows.
      const db = app.get<AppDatabase>(DATABASE);
      expect(db.select().from(connections).all()).toEqual([
        { id: 1, bankName: 'Swedbank', sessionId: 'session-1', validUntil: SESSION_VALID_UNTIL },
      ]);
      expect(db.select().from(accounts).all()).toContainEqual({
        id: 2,
        connectionId: 1,
        identificationHash: 'hash-1',
        uid: 'uid-1',
        name: 'Lönekonto',
        type: 'payment',
        currency: 'SEK',
        raw: '{"uid":"uid-1"}',
        closed: false,
      });
    });

    describe('when it cannot be completed', () => {
      const FAILED = '/anslut-bank/resultat?status=fel';

      beforeEach(async () => {
        enableBanking.banks = [bank('Swedbank')];
        enableBanking.session = session;
        await start();
      });

      it.each([
        ['has no state', {}],
        ['has an unknown state', { state: 'made-up', code: 'the-code' }],
      ])('shows a Swedish error page when the callback %s', async (_name, query) => {
        const response = await callback(query).expect(400);

        expect(response.type).toBe('text/html');
        expect(response.text).toContain('Anslutningen kunde inte slutföras');
        expect(enableBanking.redeemedCodes).toEqual([]);
        expect((await getAccounts()).banks).toEqual([]);
      });

      it('does not accept the same state twice', async () => {
        const state = await begin('Swedbank');
        await callback({ code: 'the-code', state }).expect(302);

        await callback({ code: 'the-code', state }).expect(400);
        expect(enableBanking.redeemedCodes).toEqual(['the-code']);
      });

      it('does not accept a login that was started long ago', async () => {
        const state = await begin('Swedbank');
        now = new Date(START.getTime() + 16 * MINUTE);

        await callback({ code: 'the-code', state }).expect(400);

        expect(enableBanking.redeemedCodes).toEqual([]);
      });

      it('connects a bank that returns no accounts', async () => {
        enableBanking.session = { ...session, accounts: [] };
        const state = await begin('Swedbank');

        await callback({ code: 'the-code', state }).expect(302);

        expect(await getAccounts()).toEqual({ banks: [] });
      });

      it('treats a repeated state parameter as unknown', async () => {
        await request(app.getHttpServer())
          .get('/api/connections/callback?state=a&state=b')
          .expect(400);
      });

      it('reports a cancelled BankID login and creates nothing', async () => {
        const state = await begin('Swedbank');

        const response = await callback({ error: 'access_denied', state }).expect(302);

        expect(response.headers['location']).toBe(FAILED);
        expect(enableBanking.redeemedCodes).toEqual([]);
        expect((await getAccounts()).banks).toEqual([]);
      });

      it('reports a failed login and creates nothing', async () => {
        enableBanking.session = undefined;
        const state = await begin('Swedbank');

        const response = await callback({ code: 'bad-code', state }).expect(302);

        expect(response.headers['location']).toBe(FAILED);
        expect((await getAccounts()).banks).toEqual([]);
      });
    });

    describe('for a bank that is already connected', () => {
      beforeEach(async () => {
        enableBanking.banks = [bank('Swedbank')];
        enableBanking.session = session;
        await start();
      });

      it('refuses to start another connection', async () => {
        const state = await begin('Swedbank');
        await callback({ code: 'the-code', state }).expect(302);

        await startConnection('Swedbank').expect(409);

        expect(enableBanking.authorisations).toHaveLength(1);
      });

      it('keeps one connection when two logins were started before either finished', async () => {
        const first = await begin('Swedbank');
        const second = await begin('Swedbank');
        await callback({ code: 'code-1', state: first }).expect(302);

        const response = await callback({ code: 'code-2', state: second }).expect(302);

        expect(response.headers['location']).toBe(
          '/anslut-bank/resultat?status=redan&bank=Swedbank',
        );
        expect(enableBanking.redeemedCodes).toEqual(['code-1']);
        expect(app.get<AppDatabase>(DATABASE).select().from(connections).all()).toHaveLength(1);
      });
    });
  });

  describe('the accounts overview', () => {
    it('is empty when no bank is connected', async () => {
      await start();

      expect(await getAccounts()).toEqual({ banks: [] });
    });

    it('groups the accounts by bank, sorted by bank name', async () => {
      enableBanking.banks = [bank('Swedbank'), bank('Coop Mastercard')];
      await start();
      enableBanking.session = session;
      await callback({ code: 'c1', state: await begin('Swedbank') }).expect(302);
      enableBanking.session = {
        sessionId: 'session-2',
        validUntil: SESSION_VALID_UNTIL,
        accounts: [
          {
            uid: 'u3',
            identificationHash: 'h3',
            name: 'Coop Mastercard',
            type: 'card',
            currency: 'SEK',
            raw: '{}',
          },
        ],
      };
      await callback({ code: 'c2', state: await begin('Coop Mastercard') }).expect(302);

      expect(await getAccounts()).toEqual({
        banks: [
          { bank: 'Coop Mastercard', accounts: [{ name: 'Coop Mastercard', type: 'card' }] },
          {
            bank: 'Swedbank',
            accounts: [
              { name: 'Lönekonto', type: 'payment' },
              { name: 'Sparkonto', type: 'savings' },
            ],
          },
        ],
      });
    });
  });
});
