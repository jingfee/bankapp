import type {
  EffectiveShare,
  HouseholdRatioEntry,
  ShareOption,
  ShareSource,
} from '@bankapp/shared';
import { asc, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../db/database';
import { accounts, householdRatios, subcategories, transactions } from '../db/schema';

/** The owner's percentage of a transaction with each option; `household` is looked up by date. */
const FIXED_PERCENT: Record<Exclude<ShareOption, 'household'>, number> = {
  me: 100,
  half: 50,
  partner: 0,
};

/** The household ratio in force on `date`: the latest entry from then or before, else the first. `entries` is earliest first. */
export function householdPercent(entries: HouseholdRatioEntry[], date: string): number {
  const inForce = entries.filter((entry) => entry.from <= date).at(-1) ?? entries[0];
  // Hushåll cannot be chosen before an entry exists; 100 keeps an orphaned option harmless.
  return inForce?.percent ?? 100;
}

export interface ShareSources {
  transaction: ShareOption | null;
  account: ShareOption | null;
  subcategory: ShareOption | null;
}

/** The first of the transaction's, its account's and its subcategory's share that is set, else Jag. */
export function resolveShare(
  sources: ShareSources,
  date: string,
  ratio: HouseholdRatioEntry[],
): EffectiveShare {
  const order: [ShareSource, ShareOption | null][] = [
    ['transaction', sources.transaction],
    ['account', sources.account],
    ['subcategory', sources.subcategory],
  ];
  const [source, option] = order.find(([, option]) => option !== null) ?? ['default', 'me'];
  const chosen = option ?? 'me';
  return {
    option: chosen,
    percent: chosen === 'household' ? householdPercent(ratio, date) : FIXED_PERCENT[chosen],
    source,
  };
}

/** The household ratio, earliest entry first. */
export function loadHouseholdRatio(db: Pick<AppDatabase, 'select'>): HouseholdRatioEntry[] {
  return db.select().from(householdRatios).orderBy(asc(householdRatios.from)).all();
}

type TransactionRow = typeof transactions.$inferSelect;

/**
 * The effective share of each given transaction, by id. An offset refund takes its purchase's
 * share, worked out with the purchase's date (ADR 0007, 0011) and reported as `purchase`.
 */
export function effectiveShares(
  db: Pick<AppDatabase, 'select'>,
  rows: TransactionRow[],
): Map<number, EffectiveShare> {
  const ratio = loadHouseholdRatio(db);
  const accountShares = new Map(
    db
      .select({ id: accounts.id, share: accounts.share })
      .from(accounts)
      .all()
      .map((a) => [a.id, a.share]),
  );
  const subcategoryShares = new Map(
    db
      .select({ id: subcategories.id, share: subcategories.share })
      .from(subcategories)
      .all()
      .map((s) => [s.id, s.share]),
  );
  const purchaseIds = [
    ...new Set(
      rows.flatMap((row) => (row.offsetsTransactionId === null ? [] : [row.offsetsTransactionId])),
    ),
  ];
  const purchases = new Map<number, TransactionRow>(
    purchaseIds.length === 0
      ? []
      : db
          .select()
          .from(transactions)
          .where(inArray(transactions.id, purchaseIds))
          .all()
          .map((row) => [row.id, row]),
  );

  const own = (row: TransactionRow): EffectiveShare =>
    resolveShare(
      {
        transaction: row.share,
        account: accountShares.get(row.accountId) ?? null,
        subcategory:
          row.subcategoryId === null ? null : (subcategoryShares.get(row.subcategoryId) ?? null),
      },
      row.date,
      ratio,
    );

  return new Map(
    rows.map((row) => {
      const purchase =
        row.offsetsTransactionId === null ? undefined : purchases.get(row.offsetsTransactionId);
      return [
        row.id,
        purchase === undefined ? own(row) : { ...own(purchase), source: 'purchase' as const },
      ];
    }),
  );
}

/** Whether an option may be chosen: Hushåll needs at least one household ratio entry. */
export function canChoose(db: Pick<AppDatabase, 'select'>, option: ShareOption): boolean {
  return option !== 'household' || loadHouseholdRatio(db).length > 0;
}
