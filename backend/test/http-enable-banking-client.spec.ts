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
  let requests: { url: string; headers: Record<string, string> }[];
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
          headers: init?.headers as Record<string, string>,
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
          { name: 'Northmill', country: 'SE', logo: 'https://logos.example/n.png', beta: true },
          { name: 'Skandia', country: 'SE' },
        ],
      });

    expect(await client().listBanks('SE')).toEqual([
      { name: 'Northmill', country: 'SE', logoUrl: 'https://logos.example/n.png', beta: true },
      { name: 'Skandia', country: 'SE', logoUrl: null, beta: false },
    ]);
  });

  it('fails clearly when Enable Banking answers with an error', async () => {
    respond = () => new Response('nope', { status: 401 });

    await expect(client().listBanks('SE')).rejects.toThrow(/401/);
  });
});
