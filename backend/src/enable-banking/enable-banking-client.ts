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

/** One balance of an account. Banks report several kinds, e.g. `CLBD` (closing booked). */
export interface EnableBankingBalance {
  /** ISO 20022 balance type as the bank reports it, e.g. `CLBD`, `ITBD`, `ITAV`. */
  type: string;
  /** As the bank reports it; banks differ in whether the sign or {@link creditDebit} carries direction. */
  amount: number;
  currency: string;
  /** The day the balance applies to (`YYYY-MM-DD`), when the bank says. */
  referenceDate: string | null;
  /** Whether the bank reports the amount as money owed to (`credit`) or by (`debit`) the owner. */
  creditDebit: 'credit' | 'debit' | null;
}

/** One transaction of an account, parsed from the bank's response. */
export interface EnableBankingTransaction {
  status: 'booked' | 'pending';
  /** Negative when money leaves the account. */
  amount: number;
  currency: string;
  /** `YYYY-MM-DD`, when the bank says. Pending transactions often have none. */
  bookingDate: string | null;
  /** `YYYY-MM-DD`; falls back to the bank's transaction date when it gives no value date. */
  valueDate: string | null;
  description: string;
  /** The bank's own identifier for a booked transaction, when it gives one. */
  entryReference: string | null;
  /** The transaction exactly as the bank returned it, as JSON (ADR 0001). */
  raw: string;
}

/** The owner's device, sent so the bank treats a request as made with the owner present. */
export interface PsuContext {
  ipAddress: string;
  userAgent: string;
}

export interface RequestOptions {
  /** Set for requests made while the owner is present; omit for unattended ones. */
  psu?: PsuContext;
}

export interface TransactionsRequestOptions extends RequestOptions {
  /** `YYYY-MM-DD`. Fetches from this day on; without it the longest history the bank returns. */
  dateFrom?: string;
}

/** The bank (or Enable Banking) refused because the account was asked for too often. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
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
  /** Every balance the bank reports for the account with this Enable Banking `uid`. */
  abstract getBalances(
    accountUid: string,
    options?: RequestOptions,
  ): Promise<EnableBankingBalance[]>;
  /**
   * The transactions of the account from `dateFrom`, or the longest history the bank returns,
   * with every page already fetched. Both fetches reject with {@link RateLimitError} when the
   * bank says the account was asked for too often.
   */
  abstract getTransactions(
    accountUid: string,
    options?: TransactionsRequestOptions,
  ): Promise<EnableBankingTransaction[]>;
}
