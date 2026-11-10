/** Whether a bank takes the owner's personnummer when starting the BankID login. */
export type PersonnummerSupport = 'none' | 'optional' | 'required';

/** A bank as Enable Banking describes it (an "ASPSP"). */
export interface EnableBankingBank {
  name: string;
  country: string;
  logoUrl: string | null;
  beta: boolean;
  /** The longest permission the bank grants, in seconds. */
  maximumConsentSeconds: number;
  personnummer: PersonnummerSupport;
}

export interface AuthorisationRequest {
  bank: string;
  country: string;
  validUntil: Date;
  /** Echoed back to the redirect URL; ties the return to this request. */
  state: string;
  redirectUrl: string;
  /** Only set for banks that take it. 12 digits, e.g. `199001011234`. */
  personnummer?: string;
}

export type EnableBankingAccountType = 'payment' | 'savings' | 'card';

export interface EnableBankingAccount {
  uid: string;
  identificationHash: string;
  name: string;
  type: EnableBankingAccountType;
  currency: string;
}

/** What a successful BankID login yields. */
export interface EnableBankingSession {
  sessionId: string;
  validUntil: Date;
  accounts: EnableBankingAccount[];
}

/**
 * The narrow seam to Enable Banking. Backend tests use a fake implementation; the real one is
 * {@link HttpEnableBankingClient}. Add methods here as features need them.
 */
export abstract class EnableBankingClient {
  abstract listBanks(country: string): Promise<EnableBankingBank[]>;
  /** Starts a BankID login and returns the bank's authorisation URL. */
  abstract startAuthorisation(request: AuthorisationRequest): Promise<{ url: string }>;
  /** Exchanges the code from the redirect for a session with the bank's accounts. */
  abstract createSession(code: string): Promise<EnableBankingSession>;
}
