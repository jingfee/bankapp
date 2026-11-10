import type { AppConfig } from '../src/config/config';
import type {
  EnableBankingBank,
  EnableBankingClient,
} from '../src/enable-banking/enable-banking-client';

export const testConfig: AppConfig = {
  applicationId: 'test-application-id',
  privateKeyPath: '/not/used/in/tests.pem',
  redirectUrl: 'http://localhost:4200/callback',
  dataDir: '/not/used/in/tests',
  timezone: 'Europe/Stockholm',
};

/** Stands in for Enable Banking in backend tests. */
export class FakeEnableBankingClient implements EnableBankingClient {
  banks: EnableBankingBank[] = [];
  failWith: Error | undefined;
  requestedCountries: string[] = [];

  listBanks(country: string): Promise<EnableBankingBank[]> {
    this.requestedCountries.push(country);
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.banks);
  }
}

export function bank(name: string, overrides: Partial<EnableBankingBank> = {}): EnableBankingBank {
  return { name, country: 'SE', logoUrl: null, beta: false, ...overrides };
}
