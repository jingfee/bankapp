import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify } from 'jose';
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
              name: 'Lönekonto',
              cash_account_type: 'CACC',
              currency: 'SEK',
            },
            {
              uid: 'u2',
              identification_hash: 'h2',
              details: 'Sparkonto',
              cash_account_type: 'SVGS',
              currency: 'SEK',
            },
            {
              uid: 'u3',
              identification_hash: 'h3',
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
});
