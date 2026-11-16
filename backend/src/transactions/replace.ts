import { Inject, Injectable } from '@nestjs/common';
import type { ReplacementSuggestion } from '@bankapp/shared';
import { and, eq, isNotNull, isNull, lt, not, or, type SQL } from 'drizzle-orm';
import { Categorising } from '../categories/guessing/categorising';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { replaceRejections, transactions } from '../db/schema';
import {
  AlreadyReplaced,
  NoSuchTransaction,
  NotAManualAndBankPair,
  NotReplaceable,
} from '../domain-errors';
import { daysBetween } from './offset';
import { isReplaced, listedTransaction, onVisibleAccount } from './query';
import { effectiveShares } from './shares';

/** How far apart a manual transaction and its bank transaction may be (ADR 0009). */
const REPLACE_WINDOW_DAYS = 5;

/** The amount difference allowed between a manual transaction and its bank transaction. */
function replaceTolerance(amount: number): number {
  return Math.max(2, Math.abs(amount) * 0.02);
}

type Row = typeof transactions.$inferSelect;

/**
 * The eligibility rule, defined once (ADR 0009): a manual transaction paid by the owner, money
 * out, can be replaced by a bank transaction in SEK, money out, that is not a refund.
 */
const isReplaceableManual: SQL = and(
  isNull(transactions.accountId),
  eq(transactions.paidBy, 'owner'),
  lt(transactions.amount, 0),
)!;
const isReplacingBank: SQL = and(
  isNotNull(transactions.accountId),
  lt(transactions.amount, 0),
  eq(transactions.currency, 'SEK'),
  isNull(transactions.offsetsTransactionId),
)!;

/** Whether a bank transaction looks like the purchase a manual transaction records. */
function looksSame(manual: Row, bank: Row): boolean {
  return (
    // A hair of slack, as amounts are floats of öre.
    Math.abs(manual.amount - bank.amount) <= replaceTolerance(manual.amount) + 1e-9 &&
    Math.abs(daysBetween(manual.date, bank.date)) <= REPLACE_WINDOW_DAYS
  );
}

/** Replacing a manual transaction with the bank transaction that later arrives (ADR 0009). */
@Injectable()
export class Replace {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    private readonly categorising: Categorising,
  ) {}

  /**
   * Bank transactions that may be the purchase of a manual transaction paid by the owner,
   * closest first. Each manual and each bank transaction is in at most one pair, so the owner
   * is never offered contradicting choices.
   */
  suggestions(): ReplacementSuggestion[] {
    const manuals = this.db
      .select()
      .from(transactions)
      .where(and(isReplaceableManual, not(isReplaced(this.db))))
      .all();
    if (manuals.length === 0) return [];
    const rejected = new Set(
      this.db
        .select()
        .from(replaceRejections)
        .all()
        .map((r) => `${r.manualTransactionId}:${r.bankTransactionId}`),
    );
    const banks = this.db
      .select()
      .from(transactions)
      .where(
        and(onVisibleAccount(this.db), isReplacingBank, isNull(transactions.replacesTransactionId)),
      )
      .all();
    const pairs = manuals
      .flatMap((manual) =>
        banks
          .filter((bank) => looksSame(manual, bank) && !rejected.has(`${manual.id}:${bank.id}`))
          .map((replacing) => ({ manual, bank: replacing })),
      )
      .sort(
        (a, b) =>
          Math.abs(a.manual.amount - a.bank.amount) - Math.abs(b.manual.amount - b.bank.amount) ||
          Math.abs(daysBetween(a.manual.date, a.bank.date)) -
            Math.abs(daysBetween(b.manual.date, b.bank.date)) ||
          b.bank.id - a.bank.id,
      );
    const usedManuals = new Set<number>();
    const usedBanks = new Set<number>();
    return pairs
      .filter(({ manual, bank }) => {
        if (usedManuals.has(manual.id) || usedBanks.has(bank.id)) return false;
        usedManuals.add(manual.id);
        usedBanks.add(bank.id);
        return true;
      })
      .map(({ manual, bank }) => ({
        manual: listedTransaction(this.db, manual.id)!,
        bank: listedTransaction(this.db, bank.id)!,
      }));
  }

  /**
   * The bank transaction replaces the manual one: it takes the manual transaction's
   * subcategory (confirmed) and share, and the manual one is hidden from then on.
   */
  replace(manualId: number, bankId: number): void {
    this.db.transaction((tx) => {
      const manual = tx.select().from(transactions).where(eq(transactions.id, manualId)).get();
      const bank = tx.select().from(transactions).where(eq(transactions.id, bankId)).get();
      if (manual === undefined || bank === undefined) throw new NoSuchTransaction();
      const eligible =
        tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.id, manualId), isReplaceableManual))
          .get() !== undefined &&
        tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.id, bankId), isReplacingBank))
          .get() !== undefined;
      if (!eligible) throw new NotReplaceable();
      const taken = tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          or(
            eq(transactions.replacesTransactionId, manualId),
            and(eq(transactions.id, bankId), isNotNull(transactions.replacesTransactionId)),
          ),
        )
        .get();
      if (taken !== undefined) throw new AlreadyReplaced();
      tx.update(transactions)
        .set({
          replacesTransactionId: manualId,
          // The share the manual transaction counted with, so the purchase keeps its split.
          share: effectiveShares(tx, [manual]).get(manualId)!.option,
        })
        .where(eq(transactions.id, bankId))
        .run();
      this.categorising.confirm(tx, bankId, manual.subcategoryId);
      // A refund offset against the manual transaction follows the bank one instead.
      tx.update(transactions)
        .set({ offsetsTransactionId: bankId })
        .where(eq(transactions.offsetsTransactionId, manualId))
        .run();
      this.categorising.followPurchases(tx);
    });
  }

  /** Stores that the two are not the same purchase, so they are not suggested again. */
  notSame(manualId: number, bankId: number): void {
    const manual = this.db.select().from(transactions).where(eq(transactions.id, manualId)).get();
    const bank = this.db.select().from(transactions).where(eq(transactions.id, bankId)).get();
    if (manual === undefined || bank === undefined) throw new NoSuchTransaction();
    if (manual.accountId !== null || bank.accountId === null) throw new NotAManualAndBankPair();
    this.db
      .insert(replaceRejections)
      .values({ manualTransactionId: manualId, bankTransactionId: bankId })
      .onConflictDoNothing()
      .run();
  }
}
