export type AccountType = 'payment' | 'savings' | 'card';

/** An amount of money, negative when money is owed. */
export interface Money {
  amount: number;
  currency: string;
}

export interface ConnectedAccount {
  name: string;
  type: AccountType;
  /** The balance shown on the overview, or null when none has been fetched yet. */
  balance: Money | null;
  /** When the account was last synced successfully (ISO 8601), or null if it never was. */
  lastSyncedAt: string | null;
}

/** The accounts of one connected bank. */
export interface BankAccounts {
  bank: string;
  accounts: ConnectedAccount[];
}

/** Response body of `GET /api/accounts`, banks sorted by name and accounts by name. */
export interface AccountsResponse {
  banks: BankAccounts[];
  /** True while a sync is running; the overview refreshes until it is false. */
  syncing: boolean;
}
