import type { AppConfig } from '../src/config/config';
import type {
  AuthorisationRequest,
  EnableBankingBalance,
  EnableBankingBank,
  EnableBankingClient,
  EnableBankingSession,
  EnableBankingTransaction,
} from '../src/enable-banking/enable-banking-client';

export const testConfig: AppConfig = {
  applicationId: 'test-application-id',
  privateKeyPath: '/not/used/in/tests.pem',
  redirectUrl: 'http://localhost:3000/api/connections/callback',
  personnummer: undefined,
  dataDir: '/not/used/in/tests',
  timezone: 'Europe/Stockholm',
};

/** Stands in for Enable Banking in backend tests. */
export class FakeEnableBankingClient implements EnableBankingClient {
  banks: EnableBankingBank[] = [];
  failWith: Error | undefined;
  /** Makes `startAuthorisation` fail, as Enable Banking does when it rejects the request. */
  failAuthorisationWith: Error | undefined;
  requestedCountries: string[] = [];
  authorisations: AuthorisationRequest[] = [];
  /** What the bank returns when the owner completes BankID; `createSession` fails if unset. */
  session: EnableBankingSession | undefined;
  redeemedCodes: string[] = [];
  /** Balances by account `uid`; an account without an entry has none. */
  balances = new Map<string, EnableBankingBalance[]>();
  /** Account `uid`s whose balances the bank refuses to return. */
  failingBalances = new Set<string>();
  /** While set, balance requests wait for it, so a sync can be observed while running. */
  holdBalances: Promise<void> | undefined;
  requestedBalances: string[] = [];
  /** Transactions by account `uid`; an account without an entry has none. */
  transactions = new Map<string, EnableBankingTransaction[]>();
  /** Account `uid`s whose transactions the bank refuses to return. */
  failingTransactions = new Set<string>();
  requestedTransactions: string[] = [];

  listBanks(country: string): Promise<EnableBankingBank[]> {
    this.requestedCountries.push(country);
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.banks);
  }

  startAuthorisation(request: AuthorisationRequest): Promise<{ url: string }> {
    this.authorisations.push(request);
    if (this.failAuthorisationWith) return Promise.reject(this.failAuthorisationWith);
    return Promise.resolve({ url: `https://bankid.example/auth?bank=${request.bank}` });
  }

  createSession(code: string): Promise<EnableBankingSession> {
    this.redeemedCodes.push(code);
    return this.session
      ? Promise.resolve(this.session)
      : Promise.reject(new Error('Enable Banking refused the code'));
  }

  async getBalances(accountUid: string): Promise<EnableBankingBalance[]> {
    this.requestedBalances.push(accountUid);
    await this.holdBalances;
    if (this.failingBalances.has(accountUid)) throw new Error('The bank refused the request');
    return this.balances.get(accountUid) ?? [];
  }

  getTransactions(accountUid: string): Promise<EnableBankingTransaction[]> {
    this.requestedTransactions.push(accountUid);
    if (this.failingTransactions.has(accountUid)) {
      return Promise.reject(new Error('The bank refused the request'));
    }
    return Promise.resolve(this.transactions.get(accountUid) ?? []);
  }
}

export function bank(name: string, overrides: Partial<EnableBankingBank> = {}): EnableBankingBank {
  return {
    name,
    country: 'SE',
    logoUrl: null,
    beta: false,
    maximumConsentSeconds: 90 * 24 * 3600,
    personnummer: 'none',
    ...overrides,
  };
}
