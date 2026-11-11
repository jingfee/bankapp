import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Transaction, TransactionDetails, TransactionsResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

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

  /** One page of the transactions of every account, newest first; `before` continues a previous page. */
  list(before?: string): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>('/api/transactions', {
      params: before === undefined ? {} : { before },
    });
  }

  /** One transaction in full; errors with a 404 when it no longer exists. */
  get(id: string): Observable<TransactionDetails> {
    return this.http.get<TransactionDetails>(`/api/transactions/${encodeURIComponent(id)}`);
  }
}
