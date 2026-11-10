/** A bank as Enable Banking describes it (an "ASPSP"). */
export interface EnableBankingBank {
  name: string;
  country: string;
  logoUrl: string | null;
  beta: boolean;
}

/**
 * The narrow seam to Enable Banking. Backend tests use a fake implementation; the real one is
 * {@link HttpEnableBankingClient}. Add methods here as features need them.
 */
export abstract class EnableBankingClient {
  abstract listBanks(country: string): Promise<EnableBankingBank[]>;
}
