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
  /** The owner's whole percentage of the amount under {@link share}; names the Hushåll ratio. */
  ownerPercent: number;
  /** The category and subcategory names; null while uncategorised. */
  category: string | null;
  subcategory: string | null;
  paidBy: 'owner' | 'partner';
  status: 'booked' | 'pending';
  /** The partner's part, 100% − share of the amount, sign-flipped: a purchase gives a positive one. */
  partnerPart: number;
}

/** One settlement the partner paid within a period. */
export interface SettlementPayment {
  transactionId: number;
  /** The transaction date: when it was reserved, not booked. */
  date: string;
  description: string;
  amount: number;
}

/** A named month the owner closes by hand (ADR 0014). */
export interface SettlementPeriod {
  /** `YYYY-MM`; kept until the period is closed, however late that is. */
  month: string;
  /** The last day belonging to the period, or null for the open period. */
  closedThrough: string | null;
  /** The first day of the period: the day after the previous close; null for the first period. */
  startsOn: string | null;
  /** Closed periods only: whether the Excel report is saved on disk; null for the open period. */
  reportSaved: boolean | null;
  /** The balance when the period began. */
  carriedIn: number;
  /** Balance settings made within the period, in order; each replaces the running balance. */
  balanceSettings: BalanceSetting[];
  /** The shared transactions dated in the period, oldest first. */
  items: SettlementItem[];
  /** The settlements in the period, oldest first. */
  payments: SettlementPayment[];
  /** What the settlements in the period paid in total. */
  paid: number;
  /** The balance when the period ended; for the open period, the settlement balance now. */
  carriedOut: number;
  /** Open period only: its month ended 7 or more days ago and it is still not closed. */
  overdue: boolean;
}

/**
 * Response body of `GET /api/names`: what the UI calls the owner and the partner, from
 * OWNER_NAME and PARTNER_NAME (_Jag_ and _Partner_ when not set).
 */
export interface PartyNames {
  owner: string;
  partner: string;
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

/** Request body of `POST /api/settlement/close`. */
export interface CloseMonthRequest {
  /** The last day belonging to the closed period; not before the previous close, not after today. */
  closedThrough: string;
  /** `YYYY-MM`: the month of the period the close opens; later than the closed month. */
  nextMonth: string;
}

/** Request body of `PUT /api/settlement/month`. */
export interface SetOpenMonthRequest {
  /** `YYYY-MM`: later than the latest closed period's month. */
  month: string;
}
