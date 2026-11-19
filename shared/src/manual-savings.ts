/** One balance entry: the owner stating what a manual savings account held on a day. */
export interface BalanceEntry {
  id: number;
  /** `YYYY-MM-DD`. */
  date: string;
  /** In kr. */
  balance: number;
  /** In kr, as the broker shows it; null when left blank (unchanged since the previous entry). */
  netDeposits: number | null;
}

/** A manual savings account with its entries (newest first) and what they say today. */
export interface ManualSavingsAccount {
  id: number;
  name: string;
  institution: string | null;
  /** The day the owner closed it (`YYYY-MM-DD`), or null while open. */
  closedOn: string | null;
  entries: BalanceEntry[];
  /** The balance today: that of the latest entry, 0 once closed, null before the first entry. */
  balance: number | null;
  /** Null for a balance-only account (no entry has net deposits) and before the first entry. */
  netDeposits: number | null;
  /** Balance minus net deposits since opening; null when there are no net deposits. */
  growth: number | null;
  /** True when an entry left net deposits blank, so the growth is a rough figure. */
  growthApproximate: boolean;
}

export interface ManualSavingsResponse {
  accounts: ManualSavingsAccount[];
}

export interface ManualSavingsAccountRequest {
  name: string;
  institution?: string | null;
}

export interface CloseManualSavingsAccountRequest {
  /** Defaults to today. */
  date?: string;
}

export interface BalanceEntryRequest {
  /** Defaults to today; never in the future. */
  date?: string;
  balance: number;
  netDeposits?: number | null;
}
