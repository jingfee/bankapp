import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ManualTransactionRequest, PaidBy, Transaction } from '@bankapp/shared';
import { eq, or } from 'drizzle-orm';
import { Categorising } from '../categories/guessing/categorising';
import { CLOCK, isDay, localDay, type Clock } from '../clock';
import type { AppDatabase } from '../db/database';
import { DATABASE } from '../db/database.module';
import { SHARE_OPTIONS } from '../db/share-options';
import { transactions } from '../db/schema';
import type { ShareOption } from '@bankapp/shared';
import {
  InvalidInput,
  NoHouseholdRatio,
  NoSuchTransaction,
  NotManual,
  UnknownSubcategory,
} from '../domain-errors';
import { listedTransaction } from './query';
import { canChoose } from './shares';

/** Reads and checks what the owner entered for a manual transaction. */
function parse(input: unknown): ManualTransactionRequest {
  const { description, amount, subcategoryId, date, share, paidBy } = (input ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof description !== 'string' || description.trim() === '' || description.length > 200) {
    throw new InvalidInput('description must be a text of at most 200 characters');
  }
  const rounded = typeof amount === 'number' ? Math.round(amount * 100) / 100 : NaN;
  if (!Number.isFinite(rounded) || rounded === 0 || Math.abs(rounded) > 1e9) {
    throw new InvalidInput('amount must be a number other than 0, below a billion');
  }
  if (typeof subcategoryId !== 'number' || !Number.isInteger(subcategoryId)) {
    throw new InvalidInput('subcategoryId must be a subcategory id');
  }
  if (date !== undefined && (typeof date !== 'string' || !isDay(date))) {
    throw new InvalidInput('date must be a day, YYYY-MM-DD');
  }
  if (share != null && !SHARE_OPTIONS.includes(share as ShareOption)) {
    throw new InvalidInput(`share must be one of ${SHARE_OPTIONS.join(', ')} or null`);
  }
  if (paidBy != null && paidBy !== 'owner' && paidBy !== 'partner') {
    throw new InvalidInput('paidBy must be owner or partner');
  }
  return {
    description,
    amount: rounded,
    subcategoryId,
    ...(date === undefined ? {} : { date }),
    share: (share ?? null) as ShareOption | null,
    ...(paidBy == null ? {} : { paidBy: paidBy as PaidBy }),
  };
}

/** Manual transactions: money no connected account shows, entered by the owner (ADR 0009). */
@Injectable()
export class ManualTransactions {
  constructor(
    @Inject(DATABASE) private readonly db: AppDatabase,
    @Inject(CLOCK) private readonly now: Clock,
    private readonly categorising: Categorising,
  ) {}

  /**
   * Adds a manual transaction: no account, booked, its subcategory confirmed. The date is
   * today and the share the subcategory's unless given.
   */
  add(input: unknown): Transaction {
    const request = parse(input);
    this.check(request);
    const now = this.now();
    const date = request.date ?? localDay(now);
    return this.db.transaction((tx) => {
      const id = tx
        .insert(transactions)
        .values({
          accountId: null,
          status: 'booked',
          currency: 'SEK',
          dedupKey: `manual:${randomUUID()}`,
          raw: '{}',
          fetchedAt: now,
          amount: request.amount,
          description: request.description.trim(),
          share: request.share ?? null,
          paidBy: request.paidBy ?? 'owner',
          date,
          transactionDate: date,
        })
        .returning({ id: transactions.id })
        .get().id;
      this.categorising.confirm(tx, id, request.subcategoryId);
      return listedTransaction(tx, id)!;
    });
  }

  /** Replaces what the owner entered for a manual transaction; a bank transaction cannot be edited. */
  edit(id: number, input: unknown): Transaction {
    const request = parse(input);
    const current = this.db.select().from(transactions).where(eq(transactions.id, id)).get();
    // A manual transaction that a bank transaction has replaced is gone from the owner's view.
    if (current === undefined || listedTransaction(this.db, id) === null) {
      throw new NoSuchTransaction();
    }
    if (current.accountId !== null) throw new NotManual('edited');
    this.check(request);
    const date = request.date ?? current.date;
    return this.db.transaction((tx) => {
      // Refunds are money in and purchases money out, so a change of direction ends the links.
      if (Math.sign(request.amount) !== Math.sign(current.amount)) {
        tx.update(transactions)
          .set({ offsetsTransactionId: null })
          .where(or(eq(transactions.offsetsTransactionId, id), eq(transactions.id, id)))
          .run();
      }
      tx.update(transactions)
        .set({
          amount: request.amount,
          description: request.description.trim(),
          share: request.share ?? null,
          paidBy: request.paidBy ?? current.paidBy,
          date,
          transactionDate: date,
        })
        .where(eq(transactions.id, id))
        .run();
      this.categorising.confirm(tx, id, request.subcategoryId);
      return listedTransaction(tx, id)!;
    });
  }

  /** Deletes a manual transaction; a bank transaction is never deleted. */
  delete(id: number): void {
    this.db.transaction((tx) => {
      const current = tx.select().from(transactions).where(eq(transactions.id, id)).get();
      if (current === undefined) throw new NoSuchTransaction();
      if (current.accountId !== null) throw new NotManual('deleted');
      // Refunds offset against it become ordinary again, keeping the category they took.
      tx.update(transactions)
        .set({ offsetsTransactionId: null })
        .where(eq(transactions.offsetsTransactionId, id))
        .run();
      tx.delete(transactions).where(eq(transactions.id, id)).run();
    });
  }

  /** Throws why the request's subcategory or share cannot be used. */
  private check(request: ManualTransactionRequest): void {
    if (!this.categorising.subcategoryExists(this.db, request.subcategoryId)) {
      throw new UnknownSubcategory();
    }
    if (request.share != null && !canChoose(this.db, request.share)) throw new NoHouseholdRatio();
  }
}
