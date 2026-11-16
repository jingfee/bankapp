import type { CategoryIcon } from './category-icons';
import type { CategoryColour } from './category-palette';
import type { ShareOption } from './shares';

/** The owner stating the settlement balance was `amount` as of a day (ADR 0008). */
export interface BalanceSetting {
  /** Negative when the owner owed the partner. */
  amount: number;
  /** `YYYY-MM-DD`: transactions dated before it count as included, those on or after it on top. */
  asOf: string;
}

/** One transaction counted in a settlement period, with what it adds to the balance. */
export interface SettlementItem {
  transactionId: number;
  date: string;
  description: string;
  accountName: string;
  /** The subcategory's icon and its category's colour; null while uncategorised. */
  icon: CategoryIcon | null;
  colour: CategoryColour | null;
  /** The transaction's own amount, negative when money left the account. */
  amount: number;
  share: ShareOption;
  /** The partner's part, 100% − share of the amount, sign-flipped: a purchase gives a positive one. */
  partnerPart: number;
}

/** The stretch between two settlements (or since the last one, when still open). */
export interface SettlementPeriod {
  /** The balance when the period began. */
  carriedIn: number;
  /** The day of the settlement that closed it, or null for the open period. */
  closedOn: string | null;
  /** Balance settings made within the period, in order; each replaces the running balance. */
  balanceSettings: BalanceSetting[];
  /** The shared transactions dated in the period, oldest first. */
  items: SettlementItem[];
  /** What the closing settlement paid, 0 for the open period. */
  paid: number;
  /** The balance when the period ended; for the open period, the settlement balance now. */
  carriedOut: number;
}

/** Response body of `GET /api/settlement` and `POST /api/settlement/balance-settings`. */
export interface SettlementResponse {
  /** What the partner owes the owner now (negative: the owner owes), null before any setting. */
  balance: number | null;
  /** Settlement periods, newest first; empty before the first balance setting. */
  periods: SettlementPeriod[];
  /** Every balance setting, newest first. */
  balanceSettings: BalanceSetting[];
}

/** Response body of `GET /api/settlement/balance`. */
export interface SettlementBalanceResponse {
  balance: number | null;
}

/** Request body of `POST /api/settlement/balance-settings`; `asOf` defaults to today. */
export interface SetBalanceSettingRequest {
  amount: number;
  asOf?: string;
}
