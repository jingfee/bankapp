import type { Subcategory } from './categories';
import type { CategoryColour } from './category-palette';
import type { EffectiveShare, ShareOption } from './shares';

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
  /** The owner hid it: it is left off the overview and its transactions are not shown. */
  hidden: boolean;
  /** The share the owner bears of the account's transactions. */
  share: ShareOption;
  /** The balance shown on the overview, or null when none has been fetched yet. */
  balance: Money | null;
  /** When the account was last synced successfully (ISO 8601), or null if it never was. */
  lastSyncedAt: string | null;
}

/**
 * Whether the owner's permission to read a bank is still good: `expiring` within 14 days of
 * running out, `expired` once it has; an expired connection is not synced.
 */
export type ConnectionStatus = 'active' | 'expiring' | 'expired';

/** The accounts of one connected bank. */
export interface BankAccounts {
  bank: string;
  status: ConnectionStatus;
  /** When the connection's permission runs out (ISO 8601). */
  validUntil: string;
  accounts: ConnectedAccount[];
  /** Accounts a renewal no longer returned; they keep their history but are not synced. */
  closedAccounts: ConnectedAccount[];
}

/** How the most recent finished sync went. */
export interface SyncSummary {
  /** When it finished (ISO 8601). */
  finishedAt: string;
  /** Booked transactions it stored that were not there before. */
  newTransactions: number;
  /** Accounts the bank could not deliver, other than because of a rate limit. */
  failedAccounts: number;
  /** True if a bank refused because it was asked too often; the data shown is then older. */
  rateLimited: boolean;
}

/** Response body of `GET /api/accounts`, banks sorted by name and accounts by name. */
export interface AccountsResponse {
  banks: BankAccounts[];
  /** True while a sync is running; the overview refreshes until it is false. */
  syncing: boolean;
  /** The most recent finished sync, or null if none has finished yet. */
  lastSync: SyncSummary | null;
}

/** Response body of `POST /api/sync`. */
export interface StartSyncResponse {
  /** False when a sync was already running, in which case no second one was started. */
  started: boolean;
}

/** The account a transaction belongs to. */
export interface TransactionAccount {
  id: number;
  name: string;
  bank: string;
  type: AccountType;
}

/** A transaction as listed. `amount` is negative when money left the account. */
export interface Transaction {
  id: number;
  /** Pending transactions may still change or disappear before they are booked. */
  status: 'booked' | 'pending';
  amount: Money;
  /** The day it is listed under (`YYYY-MM-DD`). */
  date: string;
  description: string;
  /** The account it belongs to; null for a manual transaction, shown as _Manuell_. */
  account: TransactionAccount | null;
  /** The assigned subcategory, or null when the transaction is uncategorised. */
  category: TransactionCategory | null;
  /** The share the owner bears of it, and where that comes from. */
  share: EffectiveShare;
  /** What the owner bears of `amount`: its share's percentage, rounded half away from zero to whole öre. */
  ownerPart: number;
  /** Who paid it; always the owner for a bank transaction (ADR 0009). */
  paidBy: PaidBy;
}

/** Who paid a manual transaction: the owner (_Jag_) or the partner (_Partner_). */
export type PaidBy = 'owner' | 'partner';

/** The subcategory a transaction is assigned, with its category's name and colour. */
export interface TransactionCategory {
  category: { id: number; name: string; colour: CategoryColour };
  subcategory: Subcategory;
  /** True when the owner chose or accepted it; false for a guessed category. */
  confirmed: boolean;
}

/** Request body of `PUT /api/transactions/:id/category`; null makes the transaction uncategorised. */
export interface SetTransactionCategoryRequest {
  subcategoryId: number | null;
}

/** Response body of `PUT /api/transactions/:id/category`. */
export interface TransactionCategoryResponse {
  category: TransactionCategory | null;
  /**
   * How many other, unconfirmed transactions with the same normalised description were
   * re-guessed to match a newly chosen category; 0 when it was removed.
   */
  updatedSimilar: number;
}

/**
 * Request body of `POST /api/transactions` (add a manual transaction) and of
 * `PUT /api/transactions/:id` (edit one): the owner's own entry (ADR 0009). `amount` is in SEK
 * and negative when money left; `date` is today when left out and `share` the subcategory's
 * when left out or null.
 */
export interface ManualTransactionRequest {
  description: string;
  amount: number;
  subcategoryId: number;
  /** `YYYY-MM-DD`. */
  date?: string;
  share?: ShareOption | null;
  /** Who paid it; the owner when left out. */
  paidBy?: PaidBy;
}

/** Response body of `GET /api/transactions`: every account's transactions, newest first. */
export interface TransactionsResponse {
  transactions: Transaction[];
  /** Pass as `?before=` to get the next, older page; null when there are no more. */
  nextCursor: string | null;
  /** How many transactions match the filters, over every page. */
  count: number;
  /** Their total, or null when there are none or they mix currencies. */
  sum: Money | null;
}

/** Response body of `GET /api/transactions/review`: what is waiting for the owner's review. */
export interface TransactionReviewResponse {
  /** Guessed and uncategorised transactions, newest first. */
  transactions: Transaction[];
  /** Bank transactions that look like a manual transaction already entered, closest first. */
  replacements: ReplacementSuggestion[];
  /** Transactions to review plus suggested replacements. */
  count: number;
}

/** A manual transaction and the bank transaction that may be the same purchase (ADR 0009). */
export interface ReplacementSuggestion {
  manual: Transaction;
  bank: Transaction;
}

/** Body of `POST /api/transactions/replace` and `POST /api/transactions/not-same`. */
export interface ReplacementRequest {
  manualId: number;
  bankId: number;
}

/** Response body of `GET /api/transactions/review/count`. */
export interface TransactionReviewCountResponse {
  count: number;
}

/** The other side of a kvittning, as shown on a transaction's page. */
export interface OffsetTransaction {
  id: number;
  description: string;
  amount: Money;
  /** The day it is listed under (`YYYY-MM-DD`). */
  date: string;
}

/** Request body of `PUT /api/transactions/:id/offset`; null removes the link. */
export interface SetTransactionOffsetRequest {
  purchaseId: number | null;
}

/**
 * Response body of `GET /api/transactions/:id/offset-candidates`: purchases a money-in
 * transaction could be offset against. Without a search text they are the likely ones, best
 * match first; with one, any purchase whose description contains it, newest first.
 */
export interface OffsetCandidatesResponse {
  transactions: Transaction[];
}

/** A transaction in full, for its own page. Fields the bank did not send are null or empty. */
export interface TransactionDetails {
  id: number;
  status: 'booked' | 'pending';
  amount: Money;
  description: string;
  /** The account it belongs to; null for a manual transaction (ADR 0009). */
  account: TransactionAccount | null;
  /** The assigned subcategory, or null when the transaction is uncategorised. */
  category: TransactionCategory | null;
  /** The share the owner bears of it, and where that comes from. */
  share: EffectiveShare;
  /** What the owner bears of `amount`: its share's percentage, rounded half away from zero to whole öre. */
  ownerPart: number;
  /** Who paid it; always the owner for a bank transaction (ADR 0009). */
  paidBy: PaidBy;
  /** `YYYY-MM-DD`: the day the owner made the transaction. */
  transactionDate: string | null;
  /** `YYYY-MM-DD`: the day the bank booked it; pending transactions have none. */
  bookingDate: string | null;
  /** The other party: the creditor when money left the account, the debtor when it arrived. */
  counterparty: string | null;
  /** What was paid in a foreign currency, signed like `amount`; null for domestic purchases. */
  originalAmount: Money | null;
  /** Units of the account's currency per unit of the original currency, when the bank says. */
  exchangeRate: number | null;
  /** Free-text lines the payer gave (message, OCR); empty when none. */
  remittanceInformation: string[];
  referenceNumber: string | null;
  note: string | null;
  /** The purchase this refund is offset against (kvittad), or null. */
  offsets: OffsetTransaction | null;
  /** The refunds offset against this purchase, newest first; empty for anything else. */
  refunds: OffsetTransaction[];
  /** The purchase's amount with its refunds added; null when it has no refunds. */
  netAmount: Money | null;
  /** The transaction as the bank returned it, as stored (JSON). */
  raw: string;
}
