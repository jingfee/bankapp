import type { AppConfig } from '../src/config/config';
import type {
  AuthorisationRequest,
  EnableBankingBank,
  EnableBankingClient,
  EnableBankingSession,
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
  requestedCountries: string[] = [];
  authorisations: AuthorisationRequest[] = [];
  /** What the bank returns when the owner completes BankID; `createSession` fails if unset. */
  session: EnableBankingSession | undefined;
  redeemedCodes: string[] = [];

  listBanks(country: string): Promise<EnableBankingBank[]> {
    this.requestedCountries.push(country);
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.banks);
  }

  startAuthorisation(request: AuthorisationRequest): Promise<{ url: string }> {
    this.authorisations.push(request);
    return Promise.resolve({ url: `https://bankid.example/auth?bank=${request.bank}` });
  }

  createSession(code: string): Promise<EnableBankingSession> {
    this.redeemedCodes.push(code);
    return this.session
      ? Promise.resolve(this.session)
      : Promise.reject(new Error('Enable Banking refused the code'));
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
