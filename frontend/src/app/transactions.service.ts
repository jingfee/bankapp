import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type {
  SetTransactionCategoryRequest,
  Transaction,
  TransactionCategory,
  TransactionCategoryResponse,
  TransactionDetails,
  TransactionReviewCountResponse,
  TransactionReviewResponse,
  TransactionsResponse,
} from '@bankapp/shared';
import { type Observable, type Subscription, map, tap } from 'rxjs';

/** The part of the list the owner has loaded, kept so going back to it finds it as it was left. */
export interface ListedTransactions {
  transactions: Transaction[];
  cursor: string | null;
}

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly http = inject(HttpClient);

  /** Set by the list page; read when the owner comes back to it with the browser's back button. */
  listed: ListedTransactions | null = null;

  /** How many transactions wait for review, shown on the header icon; 0 until it is known. */
  readonly reviewCount = signal(0);

  /** One page of the transactions of every account, newest first; `before` continues a previous page. */
  list(before?: string): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>('/api/transactions', {
      params: before === undefined ? {} : { before },
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

  /**
   * Sets the owner's chosen subcategory as confirmed, or removes it with null. The list kept for
   * the way back is updated too, so it does not show the old category.
   */
  setCategory(id: number, subcategoryId: number | null): Observable<TransactionCategory | null> {
    const body: SetTransactionCategoryRequest = { subcategoryId };
    return this.http
      .put<TransactionCategoryResponse>(`/api/transactions/${id}/category`, body)
      .pipe(
        map((response) => response.category),
        tap((category) => {
          if (this.listed === null) return;
          this.listed = {
            ...this.listed,
            transactions: this.listed.transactions.map((t) =>
              t.id === id ? { ...t, category } : t,
            ),
          };
        }),
      );
  }
}
