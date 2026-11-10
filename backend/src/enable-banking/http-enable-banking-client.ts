import { SignJWT } from 'jose';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { EnableBankingBank, EnableBankingClient } from './enable-banking-client';

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
    }),
  ),
});

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
    const response = await this.get(`/aspsps?country=${encodeURIComponent(country)}`);
    const { aspsps } = aspspsResponse.parse(response);
    return aspsps.map((bank) => ({
      name: bank.name,
      country: bank.country,
      logoUrl: bank.logo ?? null,
      beta: bank.beta ?? false,
    }));
  }

  private async get(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${await this.createToken()}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Enable Banking answered ${response.status} for GET ${path}`);
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
