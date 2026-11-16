import type { Money, OffsetTransaction, TransactionDetails } from '@bankapp/shared';
import { desc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/database';
import { transactions } from '../db/schema';
import { queryTransactions } from '../transactions/query';

type Details = Pick<
  TransactionDetails,
  | 'counterparty'
  | 'originalAmount'
  | 'exchangeRate'
  | 'remittanceInformation'
  | 'referenceNumber'
  | 'note'
>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const number = (value: unknown): number | null => {
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

/**
 * Reads the fields the detail page shows out of the raw response the bank returned (ADR 0001),
 * so rows stored before the page existed have them too. Anything missing or malformed is left
 * out rather than failing; `amount` gives the direction when the bank's indicator is absent.
 */
export function parseTransactionDetails(rawJson: string, amount: number): Details {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch {
    raw = null;
  }
  const bank = isObject(raw) ? raw : {};

  const indicator = bank['credit_debit_indicator'];
  const outgoing = indicator === 'DBIT' || (indicator !== 'CRDT' && amount < 0);
  const party = bank[outgoing ? 'creditor' : 'debtor'];

  const rate = isObject(bank['exchange_rate']) ? bank['exchange_rate'] : {};
  const instructed = isObject(rate['instructed_amount']) ? rate['instructed_amount'] : {};
  const size = number(instructed['amount']);
  const currency = text(instructed['currency']);
  const originalAmount: Money | null =
    size === null || currency === null
      ? null
      : { amount: amount < 0 ? -Math.abs(size) : Math.abs(size), currency };

  const remittance = bank['remittance_information'];
  return {
    counterparty: isObject(party) ? text(party['name']) : null,
    originalAmount,
    exchangeRate: number(rate['exchange_rate']),
    remittanceInformation: Array.isArray(remittance)
      ? remittance.map(text).filter((line): line is string => line !== null)
      : [],
    referenceNumber: text(bank['reference_number']),
    note: text(bank['note']),
  };
}

function toOffsetTransaction(row: typeof transactions.$inferSelect): OffsetTransaction {
  return {
    id: row.id,
    description: row.description,
    amount: { amount: row.amount, currency: row.currency },
    date: row.date,
  };
}

/** One transaction in full, or null when there is none with this id (pending ones get a new id when they book). */
export function loadTransactionDetails(
  db: Pick<AppDatabase, 'select'>,
  id: number,
): TransactionDetails | null {
  const listed = queryTransactions(db, { where: eq(transactions.id, id), limit: 1 })[0];
  if (listed === undefined) return null;
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get()!;
  const purchaseRow =
    row.offsetsTransactionId === null
      ? undefined
      : db.select().from(transactions).where(eq(transactions.id, row.offsetsTransactionId)).get();
  const linked = db
    .select()
    .from(transactions)
    .where(eq(transactions.offsetsTransactionId, row.id))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .all();
  return {
    id: listed.id,
    status: listed.status,
    amount: listed.amount,
    description: listed.description,
    account: listed.account,
    category: listed.category,
    paidBy: listed.paidBy,
    share: listed.share,
    ownerPart: listed.ownerPart,
    transactionDate: row.transactionDate,
    bookingDate: row.bookingDate,
    ...parseTransactionDetails(row.raw, row.amount),
    offsets: purchaseRow === undefined ? null : toOffsetTransaction(purchaseRow),
    refunds: linked.map(toOffsetTransaction),
    netAmount:
      linked.length === 0
        ? null
        : {
            amount:
              Math.round((row.amount + linked.reduce((sum, r) => sum + r.amount, 0)) * 100) / 100 +
              0,
            currency: row.currency,
          },
    raw: row.raw,
  };
}
