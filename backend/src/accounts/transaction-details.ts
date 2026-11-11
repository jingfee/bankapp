import type { Money, TransactionDetails } from '@bankapp/shared';

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
