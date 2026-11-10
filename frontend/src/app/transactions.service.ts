import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { TransactionsResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly http = inject(HttpClient);

  /** One page of the transactions of every account, newest first; `before` continues a previous page. */
  list(before?: string): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>('/api/transactions', {
      params: before === undefined ? {} : { before },
    });
  }
}
