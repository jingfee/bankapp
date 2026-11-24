import type {
  EffectiveShare,
  HouseholdRatioEntry,
  ShareOption,
  ShareSource,
} from '@bankapp/shared';
import type { SubcategoryShare } from '@bankapp/shared';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { SHARE_OPTIONS } from '../db/share-options';
import {
  FollowsPurchase,
  InvalidInput,
  NoHouseholdRatio,
  NoSuchAccount,
  NoSuchSubcategory,
  NoSuchTransaction,
} from '../domain-errors';
import { accounts, householdRatios, subcategories, transactions } from '../db/schema';

/** The owner's percentage of a transaction with each option; `household` is looked up by date. */
const FIXED_PERCENT: Record<Exclude<ShareOption, 'household'>, number> = {
  me: 100,
  half: 50,
  partner: 0,
};

/** The household ratio in force on `date`: the latest entry from then or before, else the first. `entries` is earliest first. */
export function householdPercent(entries: HouseholdRatioEntry[], date: string): number {
  // Hushåll cannot be chosen before an entry exists; 100 keeps an orphaned option harmless.
  return entryInForce(entries, date)?.percent ?? 100;
}

function entryInForce(
  entries: HouseholdRatioEntry[],
  date: string,
): HouseholdRatioEntry | undefined {
  return entries.filter((entry) => entry.from <= date).at(-1) ?? entries[0];
}

/** The `from` of the entry in force on `today`, by the rule of `householdPercent`; null with no entries. */
export function inForceFrom(entries: HouseholdRatioEntry[], today: string): string | null {
  return entryInForce(entries, today)?.from ?? null;
}

export { ownerPart, roundOre } from './owners-part';

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
        account: row.accountId === null ? null : (accountShares.get(row.accountId) ?? null),
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

/** Reads a share option from a request; `null` is allowed only when `nullable`. */
function parseShare(share: unknown, nullable: false): ShareOption;
function parseShare(share: unknown, nullable: true): ShareOption | null;
function parseShare(share: unknown, nullable: boolean): ShareOption | null {
  if (nullable && share === null) return null;
  if (!SHARE_OPTIONS.includes(share as ShareOption)) {
    throw new InvalidInput(
      `share must be one of ${SHARE_OPTIONS.join(', ')}${nullable ? ' or null' : ''}`,
    );
  }
  return share as ShareOption;
}

const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** The owner's share settings: of accounts, subcategories and transactions, and the household ratio. */
@Injectable()
export class Shares {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  /**
   * Sets the share the owner bears of an account's transactions; Jag clears it, so the
   * subcategory's share can apply. Hushåll needs a household ratio first (ADR 0011).
   */
  setAccountShare(id: number, input: unknown): void {
    const share = parseShare(input, false);
    if (!canChoose(this.db, share)) throw new NoHouseholdRatio();
    const updated = this.db
      .update(accounts)
      .set({ share: share === 'me' ? null : share })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id })
      .get();
    if (updated === undefined) throw new NoSuchAccount();
  }

  /** Sets the subcategory's share option; Jag clears it. */
  setSubcategoryShare(id: number, input: unknown): void {
    const share = parseShare(input, false);
    if (!canChoose(this.db, share)) throw new NoHouseholdRatio();
    const updated = this.db
      .update(subcategories)
      .set({ share: share === 'me' ? null : share })
      .where(eq(subcategories.id, id))
      .returning({ id: subcategories.id })
      .get();
    if (updated === undefined) throw new NoSuchSubcategory();
  }

  /** The subcategories whose share is not Jag. */
  subcategoryShares(): SubcategoryShare[] {
    return this.db
      .select({ subcategoryId: subcategories.id, share: subcategories.share })
      .from(subcategories)
      .where(isNotNull(subcategories.share))
      .orderBy(asc(subcategories.id))
      .all()
      .flatMap(({ subcategoryId, share }) => (share === null ? [] : [{ subcategoryId, share }]));
  }

  /**
   * Sets the transaction's own share, or removes it with null so the account's and
   * subcategory's apply again. An offset refund takes its purchase's share and cannot have its
   * own. Hushåll needs a household ratio first (ADR 0011).
   */
  setTransactionShare(id: number, input: unknown): void {
    const share = parseShare(input, true);
    const current = this.db
      .select({ offsets: transactions.offsetsTransactionId })
      .from(transactions)
      .where(eq(transactions.id, id))
      .get();
    if (current === undefined) throw new NoSuchTransaction();
    if (current.offsets !== null) throw new FollowsPurchase();
    if (share !== null && !canChoose(this.db, share)) throw new NoHouseholdRatio();
    this.db.update(transactions).set({ share }).where(eq(transactions.id, id)).run();
  }

  /** The household ratio, earliest entry first. */
  householdRatio(): HouseholdRatioEntry[] {
    return loadHouseholdRatio(this.db);
  }

  /** Replaces the household ratio: at least one entry, each a date and a whole percentage 1-99. */
  setHouseholdRatio(input: unknown): HouseholdRatioEntry[] {
    if (!Array.isArray(input) || input.length === 0) {
      throw new InvalidInput('entries must be a list with at least one entry');
    }
    const seen = new Set<string>();
    const entries: HouseholdRatioEntry[] = [];
    for (const entry of input as { from?: unknown; percent?: unknown }[]) {
      const { from, percent } = entry ?? {};
      if (!isDate(from)) throw new InvalidInput('from must be a date, YYYY-MM-DD');
      if (
        typeof percent !== 'number' ||
        !Number.isInteger(percent) ||
        percent < 1 ||
        percent > 99
      ) {
        throw new InvalidInput('percent must be a whole number from 1 to 99');
      }
      if (seen.has(from)) throw new InvalidInput('Two entries cannot start on the same day');
      seen.add(from);
      entries.push({ from, percent });
    }
    this.db.transaction((tx) => {
      tx.delete(householdRatios).run();
      tx.insert(householdRatios).values(entries).run();
    });
    return this.householdRatio();
  }
}
