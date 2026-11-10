export type AccountType = 'payment' | 'savings' | 'card';

/** An amount of money, negative when money is owed. */
export interface Money {
  amount: number;
  currency: string;
}

export interface ConnectedAccount {
  id: number;
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

/** A transaction as listed on the account page. `amount` is negative when money left the account. */
export interface Transaction {
  id: number;
  /** Pending transactions may still change or disappear before they are booked. */
  status: 'booked' | 'pending';
  amount: Money;
  /** The day it is listed under (`YYYY-MM-DD`). */
  date: string;
  description: string;
}

/** Response body of `GET /api/accounts/:id/transactions`, newest first. */
export interface TransactionsResponse {
  account: { id: number; name: string; bank: string; type: AccountType };
  transactions: Transaction[];
  /** Pass as `?before=` to get the next, older page; null when there are no more. */
  nextCursor: string | null;
}
