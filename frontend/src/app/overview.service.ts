import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { OverviewResponse, OverviewTransactionsResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class OverviewService {
  private readonly http = inject(HttpClient);

  /** Totals and breakdown of one month (`YYYY-MM`), with the month before for comparison. */
  get(month: string): Observable<OverviewResponse> {
    return this.http.get<OverviewResponse>('/api/overview', { params: { month } });
  }

  /** The transactions of one subcategory in one month, newest first. */
  transactions(month: string, subcategoryId: number): Observable<OverviewTransactionsResponse> {
    return this.http.get<OverviewTransactionsResponse>('/api/overview/transactions', {
      params: { month, subcategoryId },
    });
  }
}
