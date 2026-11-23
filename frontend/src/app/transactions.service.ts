import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type {
  Money,
  OffsetCandidatesResponse,
  Transaction,
  TransactionDetails,
  TransactionReviewCountResponse,
  TransactionReviewResponse,
  TransactionsResponse,
} from '@bankapp/shared';
import {
  EMPTY_FILTERS,
  type TransactionFilters,
  filtersToParams,
} from './pages/transactions/transaction-filters';
import { type Observable, type Subscription, tap } from 'rxjs';
import { Invalidation } from './stores/invalidation';

/** The part of the list the owner has loaded, kept so going back to it finds it as it was left. */
export interface ListedTransactions {
  /** The query string it was loaded for; it is only shown again for the same one. */
  key: string;
  transactions: Transaction[];
  cursor: string | null;
  count: number;
  sum: Money | null;
}

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly http = inject(HttpClient);

  constructor() {
    // What changed may affect what waits for review, and the list kept for the way back shows
    // transactions and their shares.
    const invalidation = inject(Invalidation);
    invalidation.onRead('listed', () => (this.listed = null));
    invalidation.onRead('review', () => this.refreshReviewCount());
  }

  /** Set by the list page; read when the owner comes back to it with the browser's back button. */
  listed: ListedTransactions | null = null;

  /** How many transactions wait for review, shown on the header icon; 0 until it is known. */
  readonly reviewCount = signal(0);

  /**
   * One page of the transactions of every account, newest first; `before` continues a previous
   * page, and `filters` narrow the list.
   */
  list(
    before?: string,
    filters: TransactionFilters = EMPTY_FILTERS,
  ): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>('/api/transactions', {
      params: { ...filtersToParams(filters), ...(before === undefined ? {} : { before }) },
    });
  }

  /** The guessed and uncategorised transactions, newest first. Also updates `reviewCount`. */
  review(): Observable<TransactionReviewResponse> {
    return this.http.get<TransactionReviewResponse>('/api/transactions/review').pipe(
      tap((response) => {
        // This answer is newer than any count request still on its way.
        this.countRequest?.unsubscribe();
        this.reviewCount.set(response.count);
      }),
    );
  }

  private countRequest: Subscription | undefined;

  /** Fetches how many transactions wait for review into `reviewCount`; a failure leaves it as it was. */
  refreshReviewCount(): void {
    // Only the latest request may set the count, so a slow older answer cannot overwrite it.
    this.countRequest?.unsubscribe();
    this.countRequest = this.http
      .get<TransactionReviewCountResponse>('/api/transactions/review/count')
      .subscribe({
        next: (response) => this.reviewCount.set(response.count),
        error: () => undefined,
      });
  }

  /** One transaction in full; errors with a 404 when it no longer exists. */
  get(id: string): Observable<TransactionDetails> {
    return this.http.get<TransactionDetails>(`/api/transactions/${encodeURIComponent(id)}`);
  }

  /** Purchases a money-in transaction could be offset against: likely ones, or those matching `search`. */
  offsetCandidates(id: number, search = ''): Observable<OffsetCandidatesResponse> {
    return this.http.get<OffsetCandidatesResponse>(`/api/transactions/${id}/offset-candidates`, {
      params: search.trim() === '' ? {} : { q: search.trim() },
    });
  }
}
