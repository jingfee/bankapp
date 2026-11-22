import type { transactions } from '../db/schema';
import type { EnableBankingTransaction } from '../enable-banking/enable-banking-client';

type Row = typeof transactions.$inferSelect;

/** A stored pending transaction of the account, with what the owner decided about it. */
export type StoredPending = Pick<
  Row,
  | 'id'
  | 'entryReference'
  | 'dedupKey'
  | 'amount'
  | 'currency'
  | 'description'
  | 'transactionDate'
  | 'date'
  | 'subcategoryId'
  | 'categoryConfirmed'
  | 'categoryConfirmedAt'
  | 'share'
  | 'replacesTransactionId'
>;

/** A stored booked transaction of the account, as far as a pending twin can hand anything on to it. */
export type StoredBooked = Pick<
  Row,
  'id' | 'dedupKey' | 'categoryConfirmed' | 'share' | 'replacesTransactionId'
>;

/** What the account already has stored. */
export interface StoredTransactions {
  pending: StoredPending[];
  booked: StoredBooked[];
}

/** A fetched transaction as it is stored, without its account and fetch time. */
export type FetchedRow = Pick<
  Row,
  | 'status'
  | 'amount'
  | 'currency'
  | 'bookingDate'
  | 'valueDate'
  | 'transactionDate'
  | 'date'
  | 'description'
  | 'entryReference'
  | 'dedupKey'
  | 'raw'
>;

/**
 * What the owner decided about a removed pending row (a category, a share, the manual
 * transaction it replaces), as handed on to the row that takes its place.
 */
export type Inheritance = Partial<
  Pick<
    Row,
    | 'subcategoryId'
    | 'categoryConfirmed'
    | 'categoryConfirmedAt'
    | 'share'
    | 'replacesTransactionId'
  >
>;

/** A stored row the bank still returns, refreshed with what it returns now. */
export interface Update {
  id: number;
  row: FetchedRow;
  /** A pending row that is now its booked twin: it counts as a new booked transaction. */
  newlyBooked: boolean;
  /** Whether its category is to be guessed once stored, as the owner decided none. */
  guess: boolean;
}

/** What a sync changes about an account's stored transactions. */
export interface ReconcilePlan {
  /** Stored pending rows to delete, by id. */
  remove: number[];
  /** Stored rows that are kept, refreshed from the bank. */
  update: Update[];
  /** Already stored booked rows that take over what the owner decided about their removed twin. */
  inherit: { id: number; inheritance: Inheritance }[];
  /** New rows, with what each inherits from a removed pending twin. */
  insert: (FetchedRow & Inheritance)[];
}

/**
 * Matches what the bank returns for an account against what is stored for it. Booked
 * transactions are added unless already stored. A pending transaction keeps its stored row while
 * the bank returns it, and the booked transaction it turns into updates that same row (ADR 0005);
 * one the bank stops returning without a booked match is removed. A removed pending row hands
 * what the owner decided to its twin, if there is one. Upcoming transactions are left out. The
 * matching rules are provisional.
 *
 * `today` is the owner's day, used as the date of a transaction the bank gives no date for.
 * Removals are to be applied first, as an inheriting row may take over the manual transaction a
 * removed row replaced.
 */
export function reconcile(
  stored: StoredTransactions,
  fetched: EnableBankingTransaction[],
  today: string,
): ReconcilePlan {
  const occurrences = new Map<string, number>();
  const pendings = { count: 0 };
  const entries = fetched
    .filter((transaction) => !isUpcoming(transaction))
    .map((transaction) => ({
      claimed: false,
      row: toRow(transaction, today, occurrences, pendings),
    }));
  const pending = entries.filter((entry) => entry.row.status === 'pending');
  const booked = entries.filter((entry) => entry.row.status === 'booked');

  // Only a pending transaction with an entry reference can be recognised across syncs.
  const identified = stored.pending.filter((row) => row.entryReference !== null);
  const storedByKey = new Map(identified.map((row) => [row.dedupKey, row]));
  const storedBooked = new Map(stored.booked.map((row) => [row.dedupKey, row]));
  const fetchedPendingKeys = new Set(pending.map((entry) => entry.row.dedupKey));
  const kept = new Set<number>();

  // Each booked transaction is the twin of at most one pending one: first the bank's own
  // pending entry, else a stored one the bank no longer returns. Exact amounts are matched
  // before converted ones that drifted, so a drifted match cannot take an exact one's twin.
  const merges: { stored: StoredPending; booked: (typeof entries)[number] }[] = [];
  const paired = new Set<(typeof entries)[number]>();
  for (const drift of [false, true]) {
    for (const entry of booked) {
      if (paired.has(entry)) continue;
      const signature = twinSignature(entry.row);
      const twin = pending.find(
        (p) => !p.claimed && areTwins(twinSignature(p.row), signature, drift),
      );
      let row = twin ? storedByKey.get(twin.row.dedupKey) : undefined;
      if (twin) twin.claimed = true;
      else {
        row = identified.find(
          (candidate) =>
            !kept.has(candidate.id) &&
            !fetchedPendingKeys.has(candidate.dedupKey) &&
            areTwins(twinSignature(candidate), signature, drift),
        );
      }
      if (twin || row) paired.add(entry);
      if (row && !kept.has(row.id)) {
        kept.add(row.id);
        merges.push({ stored: row, booked: entry });
      }
    }
  }

  const plan: ReconcilePlan = { remove: [], update: [], inherit: [], insert: [] };
  const merged = new Set(merges.map((merge) => merge.booked));
  for (const merge of merges) {
    const existing = storedBooked.get(merge.booked.row.dedupKey);
    if (existing) {
      // The booked transaction is already stored, so the pending row is just a leftover.
      plan.remove.push(merge.stored.id);
      const inheritance = inheritedBy(existing, decisions(merge.stored));
      if (Object.keys(inheritance).length > 0) plan.inherit.push({ id: existing.id, inheritance });
    } else {
      // The reservation is dated when the purchase was made; the booked entry may carry a later
      // transaction date, so the reservation's day stays.
      const day =
        merge.stored.transactionDate === null
          ? {}
          : { transactionDate: merge.stored.transactionDate, date: merge.stored.date };
      plan.update.push({
        id: merge.stored.id,
        row: { ...merge.booked.row, ...day },
        newlyBooked: true,
        // The booked description or merchant code may give a guess the pending one did not.
        guess: merge.stored.subcategoryId === null && !merge.stored.categoryConfirmed,
      });
    }
  }

  // A pending row that is removed hands what the owner decided on to the row that replaces it,
  // so it is not lost when the pending row cannot be kept.
  const handedOn: { signature: TwinSignature; inheritance: Inheritance }[] = [];
  for (const row of stored.pending) {
    if (kept.has(row.id)) continue;
    if (row.entryReference !== null && fetchedPendingKeys.has(row.dedupKey)) continue;
    plan.remove.push(row.id);
    const inheritance = decisions(row);
    if (Object.keys(inheritance).length > 0) {
      handedOn.push({ signature: twinSignature(row), inheritance });
    }
  }
  const takeHandedOn = (row: FetchedRow): Inheritance | undefined => {
    const signature = twinSignature(row);
    let index = handedOn.findIndex((entry) => areTwins(entry.signature, signature, false));
    if (index === -1) {
      index = handedOn.findIndex((entry) => areTwins(entry.signature, signature, true));
    }
    return index === -1 ? undefined : handedOn.splice(index, 1)[0]!.inheritance;
  };

  for (const entry of entries) {
    if (entry.row.status === 'booked') {
      if (!merged.has(entry) && !storedBooked.has(entry.row.dedupKey)) {
        plan.insert.push({ ...entry.row, ...takeHandedOn(entry.row) });
      }
      continue;
    }
    if (entry.claimed) continue;
    const existing = storedByKey.get(entry.row.dedupKey);
    if (existing) {
      plan.update.push({ id: existing.id, row: entry.row, newlyBooked: false, guess: false });
    } else {
      plan.insert.push({ ...entry.row, ...takeHandedOn(entry.row) });
    }
  }
  return plan;
}

function toRow(
  transaction: EnableBankingTransaction,
  today: string,
  occurrences: Map<string, number>,
  pendings: { count: number },
): FetchedRow {
  const date =
    transaction.transactionDate ?? transaction.valueDate ?? transaction.bookingDate ?? today;
  // Fingerprints must keep using the date they were first made from, or stored transactions
  // would be stored again.
  const dedupDate =
    transaction.bookingDate ?? transaction.valueDate ?? transaction.transactionDate ?? today;
  return {
    status: transaction.status,
    amount: transaction.amount,
    currency: transaction.currency,
    bookingDate: transaction.bookingDate,
    valueDate: transaction.valueDate,
    transactionDate: transaction.transactionDate,
    date,
    description: transaction.description,
    entryReference: transaction.entryReference,
    dedupKey: dedupKey(transaction, dedupDate, occurrences, pendings),
    raw: transaction.raw,
  };
}

/** Only what the owner decided about a pending row: a share alone must not wipe a guessed category. */
function decisions(row: StoredPending): Inheritance {
  // Also when the owner removed the category: their twin must not be guessed either.
  const hasCategory = row.subcategoryId !== null || row.categoryConfirmed;
  return {
    ...(hasCategory && {
      subcategoryId: row.subcategoryId,
      categoryConfirmed: row.categoryConfirmed,
      categoryConfirmedAt: row.categoryConfirmedAt,
    }),
    ...(row.share !== null && { share: row.share }),
    // The manual transaction it replaces stays hidden behind its twin (ADR 0009).
    ...(row.replacesTransactionId !== null && {
      replacesTransactionId: row.replacesTransactionId,
    }),
  };
}

/** What an already stored booked twin takes over: nothing the owner already decided about it. */
function inheritedBy(row: StoredBooked, inheritance: Inheritance): Inheritance {
  const { share, replacesTransactionId, ...category } = inheritance;
  return {
    ...(category.categoryConfirmed !== undefined && !row.categoryConfirmed && category),
    ...(share != null && row.share === null && { share }),
    ...(replacesTransactionId != null &&
      row.replacesTransactionId === null && { replacesTransactionId }),
  };
}

/**
 * A payment the bank has scheduled but that has not happened yet, e.g. an invoice due or a
 * standing order: pending with a booking date to come and no transaction date. Unlike a card
 * reservation, which has a transaction date and no booking date, it is not stored until the
 * bank books it.
 */
function isUpcoming(transaction: EnableBankingTransaction): boolean {
  return (
    transaction.status === 'pending' &&
    transaction.transactionDate === null &&
    transaction.bookingDate !== null
  );
}

/**
 * Banks keep returning a pending transaction alongside the booked transaction it turned into, and
 * may hold a refund as pending with the wrong sign and describe the merchant differently. So two
 * transactions are twins when currency and size of the amount agree and the description's letters
 * and digits agree, or one only adds to the other, such as a reference number the bank appends
 * when booking ("lufthansa.com" becomes "Lufthansa.com 22041073").
 *
 * A purchase made in another currency is converted again when it books, so its amount drifts, and
 * the bank does not say it was in another currency. Allowing for `drift`, amounts within
 * {@link CONVERSION_DRIFT} of each other agree too, but only for two transactions made the same day.
 */
interface TwinSignature {
  size: number;
  currency: string;
  transactionDate: string | null;
  text: string;
}

/** How far a converted amount may move between reservation and booking. */
const CONVERSION_DRIFT = 0.05;

function twinSignature(row: {
  amount: number;
  currency: string;
  transactionDate: string | null;
  description: string;
}): TwinSignature {
  return {
    size: Math.abs(row.amount),
    currency: row.currency,
    transactionDate: row.transactionDate,
    text: row.description.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''),
  };
}

function areTwins(a: TwinSignature, b: TwinSignature, drift: boolean): boolean {
  if (a.currency !== b.currency) return false;
  if (a.size !== b.size) {
    if (!drift || a.transactionDate === null || a.transactionDate !== b.transactionDate) {
      return false;
    }
    if (Math.abs(a.size - b.size) > Math.max(a.size, b.size) * CONVERSION_DRIFT) return false;
  }
  if (a.text === b.text) return true;
  const [short, long] = a.text.length <= b.text.length ? [a.text, b.text] : [b.text, a.text];
  return short !== '' && long.startsWith(short);
}

/**
 * Identifies a booked transaction within its account: the bank's `entry_reference`, else a
 * fingerprint of date, amount and description plus how many identical ones came before it in
 * this response. Pending transactions are never compared, so theirs only needs to be filled in.
 */
function dedupKey(
  transaction: EnableBankingTransaction,
  date: string,
  occurrences: Map<string, number>,
  pendings: { count: number },
): string {
  if (transaction.entryReference !== null) return `ref:${transaction.entryReference}`;
  // Pending ones must not shift the index of booked ones, or a transaction would be stored again
  // under a new key when it books.
  if (transaction.status === 'pending') return `pending:${pendings.count++}:${date}`;
  const fingerprint = JSON.stringify([date, transaction.amount, transaction.description]);
  const index = occurrences.get(fingerprint) ?? 0;
  occurrences.set(fingerprint, index + 1);
  return `fp:${fingerprint}:${index}`;
}
