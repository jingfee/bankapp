import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { TransactionReviewCountResponse, TransactionReviewResponse } from '@bankapp/shared';
import { type Observable, type Subscription, tap } from 'rxjs';
import { Invalidation } from './stores/invalidation';

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly http = inject(HttpClient);

  constructor() {
    // What changed may affect what waits for review.
    const invalidation = inject(Invalidation);
    invalidation.onRead('review', () => this.refreshReviewCount());
  }

  /** How many transactions wait for review, shown on the header icon; 0 until it is known. */
  readonly reviewCount = signal(0);

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
}
