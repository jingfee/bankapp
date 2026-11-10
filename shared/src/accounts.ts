export type AccountType = 'payment' | 'savings' | 'card';

export interface ConnectedAccount {
  name: string;
  type: AccountType;
}

/** The accounts of one connected bank. */
export interface BankAccounts {
  bank: string;
  accounts: ConnectedAccount[];
}

/** Response body of `GET /api/accounts`, banks sorted by name and accounts by name. */
export interface AccountsResponse {
  banks: BankAccounts[];
}
