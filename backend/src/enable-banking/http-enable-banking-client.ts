import { SignJWT } from 'jose';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import {
  RateLimitError,
  type AuthorisationRequest,
  EnableBankingAccount,
  EnableBankingAccountType,
  EnableBankingBalance,
  EnableBankingBank,
  EnableBankingClient,
  EnableBankingSession,
  EnableBankingTransaction,
  PsuContext,
  RequestOptions,
  TransactionsRequestOptions,
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
    }),
  ),
});

const authResponse = z.object({ url: z.string() });

/** Accounts are kept as Enable Banking returned them, so only the fields we read are described. */
const accountResource = z.looseObject({
  uid: z.string().nullish(),
  identification_hash: z.string().nullish(),
  name: z.string().nullish(),
  details: z.string().nullish(),
  product: z.string().nullish(),
  account_id: z.object({ iban: z.string().nullish() }).nullish(),
  cash_account_type: z.string().nullish(),
  currency: z.string().nullish(),
});

const sessionResponse = z.object({
  session_id: z.string(),
  access: z.object({ valid_until: z.string() }),
  accounts: z.array(
    accountResource.extend({
      uid: z.string(),
      identification_hash: z.string(),
      currency: z.string(),
    }),
  ),
});

const balancesResponse = z.object({
  balances: z.array(
    z.object({
      balance_type: z.string(),
      balance_amount: z.object({ amount: z.string(), currency: z.string() }),
      reference_date: z.string().nullish(),
      credit_debit_indicator: z.string().nullish(),
    }),
  ),
});

/** Transactions are kept as the bank returned them, so only the fields we read are described. */
const transactionsResponse = z.object({
  transactions: z.array(
    z.looseObject({
      entry_reference: z.string().nullish(),
      transaction_amount: z.object({ amount: z.string(), currency: z.string() }),
      credit_debit_indicator: z.string().nullish(),
      status: z.string().nullish(),
      booking_date: z.string().nullish(),
      value_date: z.string().nullish(),
      transaction_date: z.string().nullish(),
      remittance_information: z.array(z.string()).nullish(),
      creditor: z.object({ name: z.string().nullish() }).nullish(),
      debtor: z.object({ name: z.string().nullish() }).nullish(),
      note: z.string().nullish(),
    }),
  ),
  continuation_key: z.string().nullish(),
});

/** Enough of an error body to explain a rejection without flooding the log. */
const MAX_REASON_LENGTH = 500;

/** A bank that keeps returning keys forever must not keep a sync running forever. */
const MAX_TRANSACTION_PAGES = 1000;

const ACCOUNT_TYPES: Record<string, EnableBankingAccountType> = {
  CACC: 'payment',
  SVGS: 'savings',
  CARD: 'card',
};

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
    }));
  }

  async startAuthorisation(request: AuthorisationRequest): Promise<{ url: string }> {
    const response = await this.send('POST', '/auth', {
      access: { valid_until: request.validUntil.toISOString() },
      aspsp: { name: request.bank, country: request.country },
      state: request.state,
      redirect_url: request.redirectUrl,
      psu_type: 'personal',
    });
    return { url: authResponse.parse(response).url };
  }

  async createSession(code: string): Promise<EnableBankingSession> {
    const session = sessionResponse.parse(await this.send('POST', '/sessions', { code }));
    return {
      sessionId: session.session_id,
      validUntil: new Date(session.access.valid_until),
      accounts: session.accounts.map((account) =>
        toAccount(account, account.uid, account.identification_hash),
      ),
    };
  }

  async getAccountDetails(
    accountUid: string,
    options: RequestOptions = {},
  ): Promise<EnableBankingAccount> {
    const response = await this.send(
      'GET',
      `/accounts/${encodeURIComponent(accountUid)}/details`,
      undefined,
      options.psu,
    );
    const account = accountResource.parse(response);
    return toAccount(account, account.uid ?? accountUid, account.identification_hash ?? '');
  }

  async getBalances(
    accountUid: string,
    options: RequestOptions = {},
  ): Promise<EnableBankingBalance[]> {
    const response = await this.send(
      'GET',
      `/accounts/${encodeURIComponent(accountUid)}/balances`,
      undefined,
      options.psu,
    );
    return balancesResponse.parse(response).balances.map((balance) => {
      const text = balance.balance_amount.amount.trim();
      const amount = text === '' ? Number.NaN : Number(text);
      if (!Number.isFinite(amount)) {
        throw new Error(`Enable Banking returned a balance that is not a number`);
      }
      const indicator = balance.credit_debit_indicator;
      return {
        type: balance.balance_type,
        amount,
        currency: balance.balance_amount.currency,
        referenceDate: balance.reference_date ?? null,
        creditDebit: indicator === 'DBIT' ? 'debit' : indicator === 'CRDT' ? 'credit' : null,
      };
    });
  }

  async getTransactions(
    accountUid: string,
    options: TransactionsRequestOptions = {},
  ): Promise<EnableBankingTransaction[]> {
    const range = options.dateFrom
      ? `date_from=${encodeURIComponent(options.dateFrom)}`
      : 'strategy=longest';
    const path = `/accounts/${encodeURIComponent(accountUid)}/transactions?${range}`;
    const transactions: EnableBankingTransaction[] = [];
    const seenKeys = new Set<string>();
    let key: string | null | undefined;
    do {
      const url = key ? `${path}&continuation_key=${encodeURIComponent(key)}` : path;
      const page = transactionsResponse.parse(await this.send('GET', url, undefined, options.psu));
      for (const raw of page.transactions) {
        // A rejected or cancelled attempt never happened, so the owner should not see it.
        if (raw.status === 'RJCT' || raw.status === 'CNCL') continue;
        transactions.push(toTransaction(raw));
      }
      key = page.continuation_key;
      if (key) {
        // An empty page can still carry a key, so only a missing key ends the history.
        if (seenKeys.has(key) || seenKeys.size >= MAX_TRANSACTION_PAGES) {
          throw new Error('Enable Banking did not stop returning a continuation key');
        }
        seenKeys.add(key);
      }
    } while (key);
    return transactions;
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    psu?: PsuContext,
  ): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.createToken()}`,
        Accept: 'application/json',
        ...(psu ? { 'psu-ip-address': psu.ipAddress, 'psu-user-agent': psu.userAgent } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      // The body says why (e.g. a redirect URL that is not registered); keep it for the log.
      const reason = (await response.text().catch(() => '')).trim().slice(0, MAX_REASON_LENGTH);
      const message = `Enable Banking answered ${response.status} for ${method} ${path}${reason ? `: ${reason}` : ''}`;
      if (response.status === 429 || reason.includes('ASPSP_RATE_LIMIT_EXCEEDED')) {
        throw new RateLimitError(message);
      }
      throw new Error(message);
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

function toAccount(
  account: z.infer<typeof accountResource>,
  uid: string,
  identificationHash: string,
): EnableBankingAccount {
  return {
    uid,
    identificationHash,
    // `name` is the account holder's, so it only comes after what names the account itself.
    name:
      account.details?.trim() ||
      account.product?.trim() ||
      account.account_id?.iban ||
      account.name?.trim() ||
      uid,
    type: ACCOUNT_TYPES[account.cash_account_type ?? ''] ?? 'payment',
    currency: account.currency ?? '',
    raw: JSON.stringify(account),
  };
}

function toTransaction(
  raw: z.infer<typeof transactionsResponse>['transactions'][number],
): EnableBankingTransaction {
  const text = raw.transaction_amount.amount.trim();
  const size = text === '' ? Number.NaN : Math.abs(Number(text));
  if (!Number.isFinite(size)) {
    throw new Error('Enable Banking returned a transaction amount that is not a number');
  }
  const description =
    raw.remittance_information?.join(' ').trim() ||
    raw.creditor?.name?.trim() ||
    raw.debtor?.name?.trim() ||
    raw.note?.trim() ||
    '';
  return {
    status: raw.status === 'BOOK' ? 'booked' : 'pending',
    // The indicator carries the direction; the amount itself is unsigned.
    amount: raw.credit_debit_indicator === 'DBIT' ? -size : size,
    currency: raw.transaction_amount.currency,
    bookingDate: raw.booking_date ?? null,
    valueDate: raw.value_date ?? null,
    transactionDate: raw.transaction_date ?? null,
    description,
    entryReference: raw.entry_reference ?? null,
    raw: JSON.stringify(raw),
  };
}
