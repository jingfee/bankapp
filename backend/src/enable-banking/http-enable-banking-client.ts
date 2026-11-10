import { SignJWT } from 'jose';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type {
  AuthorisationRequest,
  EnableBankingAccountType,
  EnableBankingBank,
  EnableBankingClient,
  EnableBankingSession,
  PersonnummerSupport,
} from './enable-banking-client';

/** Used when a bank does not state how long it grants access; short enough for any bank. */
const DEFAULT_CONSENT_SECONDS = 30 * 24 * 3600;

export const ENABLE_BANKING_API_URL = 'https://api.enablebanking.com';
const ISSUER = 'enablebanking.com';
const AUDIENCE = 'api.enablebanking.com';
/** Enable Banking accepts tokens valid for at most 24 hours; we mint one per request. */
export const TOKEN_LIFETIME_SECONDS = 3600;

export interface HttpEnableBankingClientOptions {
  applicationId: string;
  /** PEM-encoded RSA private key. */
  privateKeyPem: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Current time in milliseconds; injectable for tests. */
  now?: () => number;
}

const aspspsResponse = z.object({
  aspsps: z.array(
    z.object({
      name: z.string(),
      country: z.string(),
      logo: z.string().nullish(),
      beta: z.boolean().nullish(),
      maximum_consent_validity: z.number().nullish(),
      auth_methods: z
        .array(
          z.object({
            psu_type: z.string().nullish(),
            credentials: z
              .array(z.object({ name: z.string(), required: z.boolean().nullish() }))
              .nullish(),
          }),
        )
        .nullish(),
    }),
  ),
});

const authResponse = z.object({ url: z.string() });

const sessionResponse = z.object({
  session_id: z.string(),
  access: z.object({ valid_until: z.string() }),
  accounts: z.array(
    z.object({
      uid: z.string(),
      identification_hash: z.string(),
      name: z.string().nullish(),
      details: z.string().nullish(),
      account_id: z.object({ iban: z.string().nullish() }).nullish(),
      cash_account_type: z.string().nullish(),
      currency: z.string(),
    }),
  ),
});

const ACCOUNT_TYPES: Record<string, EnableBankingAccountType> = {
  CACC: 'payment',
  SVGS: 'savings',
  CARD: 'card',
};

/**
 * Banks that take the personnummer list a `userId` credential on their personal auth method.
 * Anything else (including business-only methods) means we should not send it.
 */
function personnummerSupport(
  methods: z.infer<typeof aspspsResponse>['aspsps'][number]['auth_methods'],
): PersonnummerSupport {
  const credentials = (methods ?? [])
    .filter((method) => method.psu_type === 'personal')
    .flatMap((method) => method.credentials ?? [])
    .filter((credential) => credential.name === 'userId');
  if (credentials.length === 0) return 'none';
  return credentials.some((credential) => credential.required) ? 'required' : 'optional';
}

export class HttpEnableBankingClient implements EnableBankingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly key: KeyObject;

  constructor(private readonly options: HttpEnableBankingClientOptions) {
    this.baseUrl = options.baseUrl ?? ENABLE_BANKING_API_URL;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.key = createPrivateKey(options.privateKeyPem);
  }

  async listBanks(country: string): Promise<EnableBankingBank[]> {
    const response = await this.send('GET', `/aspsps?country=${encodeURIComponent(country)}`);
    const { aspsps } = aspspsResponse.parse(response);
    return aspsps.map((bank) => ({
      name: bank.name,
      country: bank.country,
      logoUrl: bank.logo ?? null,
      beta: bank.beta ?? false,
      maximumConsentSeconds: bank.maximum_consent_validity ?? DEFAULT_CONSENT_SECONDS,
      personnummer: personnummerSupport(bank.auth_methods),
    }));
  }

  async startAuthorisation(request: AuthorisationRequest): Promise<{ url: string }> {
    const response = await this.send('POST', '/auth', {
      access: { valid_until: request.validUntil.toISOString() },
      aspsp: { name: request.bank, country: request.country },
      state: request.state,
      redirect_url: request.redirectUrl,
      psu_type: 'personal',
      ...(request.personnummer ? { psu_id: request.personnummer } : {}),
    });
    return { url: authResponse.parse(response).url };
  }

  async createSession(code: string): Promise<EnableBankingSession> {
    const session = sessionResponse.parse(await this.send('POST', '/sessions', { code }));
    return {
      sessionId: session.session_id,
      validUntil: new Date(session.access.valid_until),
      accounts: session.accounts.map((account) => ({
        uid: account.uid,
        identificationHash: account.identification_hash,
        name: account.name || account.details || account.account_id?.iban || account.uid,
        type: ACCOUNT_TYPES[account.cash_account_type ?? ''] ?? 'payment',
        currency: account.currency,
      })),
    };
  }

  private async send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.createToken()}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`Enable Banking answered ${response.status} for ${method} ${path}`);
    }
    return response.json();
  }

  private async createToken(): Promise<string> {
    const issuedAt = Math.floor(this.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ typ: 'JWT', alg: 'RS256', kid: this.options.applicationId })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + TOKEN_LIFETIME_SECONDS)
      .sign(this.key);
  }
}
