import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { TransactionsResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly http = inject(HttpClient);

  /** One page of an account's transactions, newest first; `before` continues a previous page. */
  list(accountId: number, before?: string): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>(`/api/accounts/${accountId}/transactions`, {
      params: before === undefined ? {} : { before },
    });
  }
}
