/** One savings account on the Sparande page, connected or manual. */
export interface SavingsAccount {
  /** Stable across both kinds: `connected-<id>` or `manual-<id>`. */
  key: string;
  name: string;
  /** The bank, or the broker of a manual account; null when the owner gave none. */
  institution: string | null;
  kind: 'connected' | 'manual';
  /** The manual savings account's id, to add entries to it; null for a connected account. */
  manualId: number | null;
  /** The day the account closed (`YYYY-MM-DD`); null while open. */
  closedOn: string | null;
  /** Today's balance in kr: 0 once closed, null before the first known balance. */
  balance: number | null;
  /** Null for a balance-only account and for a closed one. */
  netDeposits: number | null;
  /** Balance minus net deposits since the start; null when there are no net deposits. */
  growth: number | null;
  /** Growth as a share of net deposits, in percent; null when there is none to compare with. */
  growthPercent: number | null;
  /** True when a blank net deposits made the growth a rough figure. */
  approximate: boolean;
  /** The day of the latest balance entry or sync (`YYYY-MM-DD`); null before the first. */
  lastUpdated: string | null;
}

/** An account's figures at the end of one month. */
export interface SavingsMonthAccount {
  key: string;
  balance: number;
  /** Null while the account has no net deposits (balance only). */
  netDeposits: number | null;
  /** Growth in the month itself; null for a balance-only account. */
  growth: number | null;
}

export interface SavingsMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Accounts with a known balance by the end of the month (or today, for the current month). */
  accounts: SavingsMonthAccount[];
  /** Sum of the balances. */
  balance: number;
  /** Sum over the accounts that have net deposits; null when none do. */
  netDeposits: number | null;
  /** Growth in the month over the accounts that have net deposits; null when none do. */
  growth: number | null;
  /** True when a blank net deposits made some of this growth a rough figure. */
  approximate: boolean;
}

export interface SavingsTotals {
  /** Balance across open savings accounts. */
  balance: number;
  /** Net deposits across the accounts that have them; null when none do. */
  netDeposits: number | null;
  /** Growth across those same accounts; null when none have net deposits. */
  growth: number | null;
  /** Growth over net deposits, in percent; null when net deposits are not above 0. */
  growthPercent: number | null;
  approximate: boolean;
}

/** An open manual savings account with no balance entry in the last calendar month. */
export interface SavingsReminder {
  key: string;
  name: string;
  /** The month that ended without an entry, `YYYY-MM`. */
  month: string;
}

export interface SavingsResponse {
  accounts: SavingsAccount[];
  /** From the first known balance up to the current month; empty when there is none. */
  months: SavingsMonth[];
  totals: SavingsTotals;
  reminders: SavingsReminder[];
}
