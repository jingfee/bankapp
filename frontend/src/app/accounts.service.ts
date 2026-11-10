import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AccountsResponse, BankAccounts } from '@bankapp/shared';
import { type Observable, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly http = inject(HttpClient);

  /** The accounts of every connected bank, grouped by bank. */
  listByBank(): Observable<BankAccounts[]> {
    return this.http.get<AccountsResponse>('/api/accounts').pipe(map((response) => response.banks));
  }
}
