import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AccountsResponse, ShareOption } from '@bankapp/shared';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly http = inject(HttpClient);

  /** The accounts of every connected bank, grouped by bank, and whether a sync is running. */
  list(): Observable<AccountsResponse> {
    return this.http.get<AccountsResponse>('/api/accounts');
  }

  /** Marks an account as a savings account (followed by balance only), or clears it. */
  setSavings(id: number, savings: boolean): Observable<void> {
    return this.http.put<void>(`/api/accounts/${id}/savings`, { savings });
  }

  /** Hides an account from the overview and its transactions, or shows it again. */
  setHidden(id: number, hidden: boolean): Observable<void> {
    return this.http.put<void>(`/api/accounts/${id}/hidden`, { hidden });
  }

  /** Sets the share the owner bears of an account's transactions. */
  setShare(id: number, share: ShareOption): Observable<void> {
    return this.http.put<void>(`/api/accounts/${id}/share`, { share });
  }
}
