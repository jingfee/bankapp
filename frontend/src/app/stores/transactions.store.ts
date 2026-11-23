import { HttpClient } from '@angular/common/http';
import { Injectable, forwardRef, inject } from '@angular/core';
import type {
  ManualTransactionRequest,
  ReplacementRequest,
  SetTransactionCategoryRequest,
  SetTransactionOffsetRequest,
  SetTransactionShareRequest,
  ShareOption,
  Transaction,
  TransactionCategoryResponse,
  TransactionDetails,
} from '@bankapp/shared';
import { type Observable, tap } from 'rxjs';
import { TransactionsService } from '../transactions.service';
import { Invalidation } from './invalidation';

@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpTransactionsStore) })
export abstract class TransactionsStore {
  /** Adds a manual transaction. */
  abstract addManual(request: ManualTransactionRequest): Observable<Transaction>;
  /** Replaces what the owner entered for a manual transaction. */
  abstract editManual(id: number, request: ManualTransactionRequest): Observable<Transaction>;
  /** Deletes a manual transaction. */
  abstract deleteManual(id: number): Observable<void>;
  /** The bank transaction replaces the manual transaction it is the purchase of. */
  abstract replace(request: ReplacementRequest): Observable<void>;
  /** Says the two are not the same purchase, so they are not suggested again. */
  abstract notSame(request: ReplacementRequest): Observable<void>;
  /** Sets the owner's chosen subcategory as confirmed, or removes it with null. */
  abstract setCategory(
    id: number,
    subcategoryId: number | null,
  ): Observable<TransactionCategoryResponse>;
  /** Offsets (kvittar) a refund against a purchase, or removes the link with null. */
  abstract setOffset(id: number, purchaseId: number | null): Observable<TransactionDetails>;
  /** Sets the transaction's own share, or removes it with null so the inherited one applies. */
  abstract setShare(id: number, share: ShareOption | null): Observable<TransactionDetails>;
}

@Injectable()
export class HttpTransactionsStore extends TransactionsStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);
  // The list kept for the way back and the review count still live in the service, which also
  // listens to the map for them.
  private readonly reads = inject(TransactionsService);

  addManual(request: ManualTransactionRequest): Observable<Transaction> {
    return this.http
      .post<Transaction>('/api/transactions', request)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  editManual(id: number, request: ManualTransactionRequest): Observable<Transaction> {
    return this.http
      .put<Transaction>(`/api/transactions/${id}`, request)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  deleteManual(id: number): Observable<void> {
    return this.http
      .delete<void>(`/api/transactions/${id}`)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  replace(request: ReplacementRequest): Observable<void> {
    return this.http
      .post<void>('/api/transactions/replace', request)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  notSame(request: ReplacementRequest): Observable<void> {
    return this.http
      .post<void>('/api/transactions/not-same', request)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  /**
   * The list kept for the way back is updated in place, so it keeps its pages and does not show
   * the old category: the row itself, the similar rows that were re-guessed and the refunds that
   * follow it. A row that no longer matches an active category filter stays until the list is
   * next loaded afresh.
   */
  setCategory(id: number, subcategoryId: number | null): Observable<TransactionCategoryResponse> {
    const body: SetTransactionCategoryRequest = { subcategoryId };
    return this.http
      .put<TransactionCategoryResponse>(`/api/transactions/${id}/category`, body)
      .pipe(
        tap(({ category, others }) => {
          const listed = this.reads.listed;
          // Firing drops the kept list, so the updated one is put back afterwards.
          this.invalidation.fire('transactions');
          if (listed === null) return;
          const categories = new Map(others.map((o) => [o.id, o.category]));
          categories.set(id, category);
          // Only the rows' categories change here. With a category filter active, `count` and
          // `sum` and the rows' membership stay as loaded until the next fresh load.
          this.reads.listed = {
            ...listed,
            transactions: listed.transactions.map((t) =>
              categories.has(t.id) ? { ...t, category: categories.get(t.id)! } : t,
            ),
          };
        }),
      );
  }

  setOffset(id: number, purchaseId: number | null): Observable<TransactionDetails> {
    const body: SetTransactionOffsetRequest = { purchaseId };
    return this.http
      .put<TransactionDetails>(`/api/transactions/${id}/offset`, body)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  setShare(id: number, share: ShareOption | null): Observable<TransactionDetails> {
    const body: SetTransactionShareRequest = { share };
    return this.http
      .put<TransactionDetails>(`/api/transactions/${id}/share`, body)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }
}
