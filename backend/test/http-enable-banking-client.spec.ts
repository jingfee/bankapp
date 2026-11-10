import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { RateLimitError } from '../src/enable-banking/enable-banking-client';
import {
  HttpEnableBankingClient,
  TOKEN_LIFETIME_SECONDS,
} from '../src/enable-banking/http-enable-banking-client';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

describe('HttpEnableBankingClient', () => {
  let requests: { url: string; method: string; headers: Record<string, string>; body: unknown }[];
  let respond: () => Response;

  const client = () =>
    new HttpEnableBankingClient({
      applicationId: 'my-application-id',
      privateKeyPem,
      baseUrl: 'https://enable.test',
      now: () => NOW,
      fetch: (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? 'GET',
          headers: init?.headers as Record<string, string>,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        return Promise.resolve(respond());
      },
    });

  beforeEach(() => {
    requests = [];
    respond = () => Response.json({ aspsps: [] });
  });

  it('asks for the banks of the given country', async () => {
    await client().listBanks('SE');

    expect(requests.map((request) => request.url)).toEqual([
      'https://enable.test/aspsps?country=SE',
    ]);
  });

  it('sends an RS256 JWT with the application id as kid in the Bearer header', async () => {
    await client().listBanks('SE');

    const authorization = requests[0]!.headers['Authorization']!;
    expect(authorization).toMatch(/^Bearer /);
    const token = authorization.slice('Bearer '.length);

    expect(decodeProtectedHeader(token)).toEqual({
      typ: 'JWT',
      alg: 'RS256',
      kid: 'my-application-id',
    });
    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: 'enablebanking.com',
      audience: 'api.enablebanking.com',
      currentDate: new Date(NOW),
    });
    expect(payload.iat).toBe(NOW / 1000);
    expect(payload.exp).toBe(NOW / 1000 + TOKEN_LIFETIME_SECONDS);
  });

  it('maps banks, defaulting missing logo and beta flag', async () => {
    respond = () =>
      Response.json({
        aspsps: [
          {
            name: 'Northmill',
            country: 'SE',
            logo: 'https://logos.example/n.png',
            beta: true,
            maximum_consent_validity: 7776000,
          },
          { name: 'Skandia', country: 'SE' },
        ],
      });

    expect(await client().listBanks('SE')).toEqual([
      {
        name: 'Northmill',
        country: 'SE',
        logoUrl: 'https://logos.example/n.png',
        beta: true,
        maximumConsentSeconds: 7776000,
        personnummer: 'none',
      },
      {
        name: 'Skandia',
        country: 'SE',
        logoUrl: null,
        beta: false,
        maximumConsentSeconds: 30 * 24 * 3600,
        personnummer: 'none',
      },
    ]);
  });

  it('fails clearly when Enable Banking answers with an error', async () => {
    respond = () => new Response('nope', { status: 401 });

    await expect(client().listBanks('SE')).rejects.toThrow(/401/);
  });

  it("includes Enable Banking's explanation when it rejects a request", async () => {
    respond = () =>
      new Response('{"message":"Redirect URI not allowed"}', {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });

    await expect(client().listBanks('SE')).rejects.toThrow(
      'Enable Banking answered 400 for GET /aspsps?country=SE: {"message":"Redirect URI not allowed"}',
    );
  });

  it('cuts a long explanation short', async () => {
    respond = () => new Response('x'.repeat(5000), { status: 500 });

    await expect(client().listBanks('SE')).rejects.toThrow(/^.{1,600}$/);
  });

  it.each([
    [true, 'required'],
    [false, 'optional'],
  ])(
    'reads a personal user id credential (required: %s) as %s personnummer',
    async (isRequired, expected) => {
      respond = () =>
        Response.json({
          aspsps: [
            {
              name: 'Coop Mastercard',
              country: 'SE',
              auth_methods: [
                { name: 'BankID', psu_type: 'business', credentials: [] },
                {
                  name: 'BankID',
                  psu_type: 'personal',
                  credentials: [{ name: 'userId', title: 'Personnummer', required: isRequired }],
                },
              ],
            },
          ],
        });

      expect((await client().listBanks('SE'))[0]!.personnummer).toBe(expected);
    },
  );

  describe('startAuthorisation', () => {
    const authorisation = {
      bank: 'Swedbank',
      country: 'SE',
      validUntil: new Date('2027-02-08T12:00:00.000Z'),
      state: 'a-state',
      redirectUrl: 'https://bankapp.example/api/connections/callback',
    };

    it('posts a personal authorisation request and returns the bank URL', async () => {
      respond = () => Response.json({ url: 'https://bankid.example/go', authorization_id: 'x' });

      expect(await client().startAuthorisation(authorisation)).toEqual({
        url: 'https://bankid.example/go',
      });
      expect(requests[0]).toMatchObject({
        url: 'https://enable.test/auth',
        method: 'POST',
        body: {
          access: { valid_until: '2027-02-08T12:00:00.000Z' },
          aspsp: { name: 'Swedbank', country: 'SE' },
          state: 'a-state',
          redirect_url: 'https://bankapp.example/api/connections/callback',
          psu_type: 'personal',
        },
      });
      expect(requests[0]!.body).not.toHaveProperty('psu_id');
      expect(requests[0]!.headers['Authorization']).toMatch(/^Bearer /);
    });

    it('passes the personnummer as psu_id', async () => {
      respond = () => Response.json({ url: 'https://bankid.example/go' });

      await client().startAuthorisation({ ...authorisation, personnummer: '199001011234' });

      expect(requests[0]!.body).toMatchObject({ psu_id: '199001011234' });
    });
  });

  describe('createSession', () => {
    it('exchanges the code and maps the session and its accounts', async () => {
      respond = () =>
        Response.json({
          session_id: 'session-1',
          access: { valid_until: '2027-02-08T12:00:00.000Z' },
          accounts: [
            {
              uid: 'u1',
              identification_hash: 'h1',
              name: 'Anna Andersson',
              details: 'Lönekonto',
              product: 'Privatkonto',
              cash_account_type: 'CACC',
              currency: 'SEK',
            },
            {
              uid: 'u2',
              identification_hash: 'h2',
              name: 'Anna Andersson',
              product: 'Sparkonto',
              cash_account_type: 'SVGS',
              currency: 'SEK',
            },
            {
              uid: 'u3',
              identification_hash: 'h3',
              name: 'Anna Andersson',
              account_id: { iban: 'SE123' },
              cash_account_type: 'CARD',
              currency: 'SEK',
            },
          ],
        });

      expect(await client().createSession('the-code')).toEqual({
        sessionId: 'session-1',
        validUntil: new Date('2027-02-08T12:00:00.000Z'),
        accounts: [
          {
            uid: 'u1',
            identificationHash: 'h1',
            name: 'Lönekonto',
            type: 'payment',
            currency: 'SEK',
          },
          {
            uid: 'u2',
            identificationHash: 'h2',
            name: 'Sparkonto',
            type: 'savings',
            currency: 'SEK',
          },
          { uid: 'u3', identificationHash: 'h3', name: 'SE123', type: 'card', currency: 'SEK' },
        ],
      });
      expect(requests[0]).toMatchObject({
        url: 'https://enable.test/sessions',
        method: 'POST',
        body: { code: 'the-code' },
      });
    });
  });

  describe('getBalances', () => {
    it('fetches the balances of the account and maps every one of them', async () => {
      respond = () =>
        Response.json({
          balances: [
            {
              name: 'Booked',
              balance_amount: { currency: 'SEK', amount: '-1234.50' },
              balance_type: 'CLBD',
              reference_date: '2026-11-09',
            },
            {
              name: 'Available',
              balance_amount: { currency: 'SEK', amount: '3200.00' },
              balance_type: 'ITAV',
              credit_debit_indicator: 'DBIT',
            },
            {
              balance_amount: { currency: 'SEK', amount: '5' },
              balance_type: 'ITBD',
              credit_debit_indicator: 'CRDT',
            },
          ],
        });

      expect(await client().getBalances('u/1')).toEqual([
        {
          type: 'CLBD',
          amount: -1234.5,
          currency: 'SEK',
          referenceDate: '2026-11-09',
          creditDebit: null,
        },
        { type: 'ITAV', amount: 3200, currency: 'SEK', referenceDate: null, creditDebit: 'debit' },
        { type: 'ITBD', amount: 5, currency: 'SEK', referenceDate: null, creditDebit: 'credit' },
      ]);
      expect(requests[0]).toMatchObject({
        url: 'https://enable.test/accounts/u%2F1/balances',
        method: 'GET',
      });
    });

    it('fails on an amount that is not a number', async () => {
      respond = () =>
        Response.json({
          balances: [{ balance_amount: { currency: 'SEK', amount: ' ' }, balance_type: 'CLBD' }],
        });

      await expect(client().getBalances('u1')).rejects.toThrow('not a number');
    });
  });
  describe('on behalf of the owner', () => {
    const psu = { ipAddress: '192.168.1.20', userAgent: 'Mozilla/5.0 (Test)' };

    it('sends the owner’s IP address and user agent with balance and transaction requests', async () => {
      respond = () => Response.json({ balances: [], transactions: [] });

      await client().getBalances('u1', { psu });
      await client().getTransactions('u1', { psu });

      for (const request of requests) {
        expect(request.headers).toMatchObject({
          'psu-ip-address': '192.168.1.20',
          'psu-user-agent': 'Mozilla/5.0 (Test)',
        });
      }
    });

    it('sends no owner headers when nobody is present', async () => {
      respond = () => Response.json({ balances: [], transactions: [] });

      await client().getBalances('u1');
      await client().getTransactions('u1');

      for (const request of requests) {
        expect(request.headers).not.toHaveProperty('psu-ip-address');
        expect(request.headers).not.toHaveProperty('psu-user-agent');
      }
    });
  });

  describe('when the bank limits how often it may be asked', () => {
    it('reports an HTTP 429 as a rate limit', async () => {
      respond = () => new Response('slow down', { status: 429 });

      await expect(client().getBalances('u1')).rejects.toBeInstanceOf(RateLimitError);
    });

    it('reports ASPSP_RATE_LIMIT_EXCEEDED as a rate limit whatever the status', async () => {
      respond = () =>
        new Response('{"error":"ASPSP_RATE_LIMIT_EXCEEDED"}', {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });

      await expect(client().getTransactions('u1')).rejects.toBeInstanceOf(RateLimitError);
    });

    it('does not mistake other failures for a rate limit', async () => {
      respond = () => new Response('nope', { status: 500 });

      const error = await client()
        .getBalances('u1')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RateLimitError);
    });
  });

  describe('getTransactions from a date', () => {
    it('asks for transactions from that date instead of the longest history', async () => {
      respond = () => Response.json({ transactions: [] });

      await client().getTransactions('u1', { dateFrom: '2026-11-03' });

      expect(requests.map((request) => request.url)).toEqual([
        'https://enable.test/accounts/u1/transactions?date_from=2026-11-03',
      ]);
    });
  });

  describe('getTransactions', () => {
    const raw = (overrides: Record<string, unknown> = {}) => ({
      entry_reference: 'ref-1',
      transaction_amount: { currency: 'SEK', amount: '125.50' },
      credit_debit_indicator: 'DBIT',
      status: 'BOOK',
      booking_date: '2026-11-09',
      value_date: '2026-11-08',
      remittance_information: ['ICA Maxi', 'Stockholm'],
      ...overrides,
    });

    /** Answers each request with the next page. */
    const pages = (...bodies: unknown[]) => {
      let next = 0;
      respond = () => Response.json(bodies[next++]);
    };

    it('asks for the longest history and follows the continuation key until it runs out', async () => {
      pages(
        { transactions: [raw({ entry_reference: 'a' })], continuation_key: 'k1' },
        { transactions: [raw({ entry_reference: 'b' })], continuation_key: 'k2' },
        { transactions: [raw({ entry_reference: 'c' })], continuation_key: null },
      );

      const transactions = await client().getTransactions('u/1');

      expect(transactions.map((t) => t.entryReference)).toEqual(['a', 'b', 'c']);
      expect(requests.map((request) => request.url)).toEqual([
        'https://enable.test/accounts/u%2F1/transactions?strategy=longest',
        'https://enable.test/accounts/u%2F1/transactions?strategy=longest&continuation_key=k1',
        'https://enable.test/accounts/u%2F1/transactions?strategy=longest&continuation_key=k2',
      ]);
    });

    it('keeps going through an empty page that still carries a key', async () => {
      pages(
        { transactions: [raw({ entry_reference: 'a' })], continuation_key: 'k1' },
        { transactions: [], continuation_key: 'k2' },
        { transactions: [raw({ entry_reference: 'b' })] },
      );

      const transactions = await client().getTransactions('u1');

      expect(transactions.map((t) => t.entryReference)).toEqual(['a', 'b']);
      expect(requests).toHaveLength(3);
    });

    it('gives up when the bank keeps returning the same key', async () => {
      respond = () => Response.json({ transactions: [], continuation_key: 'stuck' });

      await expect(client().getTransactions('u1')).rejects.toThrow('continuation');
    });

    it('maps a booked debit to a negative amount with its dates and description', async () => {
      pages({ transactions: [raw()] });

      const [transaction] = await client().getTransactions('u1');

      expect(transaction).toMatchObject({
        status: 'booked',
        amount: -125.5,
        currency: 'SEK',
        bookingDate: '2026-11-09',
        valueDate: '2026-11-08',
        description: 'ICA Maxi Stockholm',
        entryReference: 'ref-1',
      });
    });

    it('maps a pending credit to a positive amount and falls back for missing fields', async () => {
      pages({
        transactions: [
          raw({
            entry_reference: null,
            status: 'PDNG',
            credit_debit_indicator: 'CRDT',
            booking_date: null,
            value_date: undefined,
            transaction_date: '2026-11-10',
            remittance_information: [],
            debtor: { name: 'Anna Andersson' },
          }),
        ],
      });

      const [transaction] = await client().getTransactions('u1');

      expect(transaction).toMatchObject({
        status: 'pending',
        amount: 125.5,
        bookingDate: null,
        valueDate: '2026-11-10',
        description: 'Anna Andersson',
        entryReference: null,
      });
    });

    it('keeps the raw transaction as the bank returned it', async () => {
      const original = raw({ some_new_field: { nested: true } });
      pages({ transactions: [original] });

      const [transaction] = await client().getTransactions('u1');

      expect(JSON.parse(transaction!.raw)).toEqual(original);
    });

    it('fails on an amount that is not a number', async () => {
      pages({ transactions: [raw({ transaction_amount: { currency: 'SEK', amount: 'x' } })] });

      await expect(client().getTransactions('u1')).rejects.toThrow('not a number');
    });
  });
});
