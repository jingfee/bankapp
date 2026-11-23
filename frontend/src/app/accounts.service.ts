import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AccountsResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly http = inject(HttpClient);

  /** The accounts of every connected bank, grouped by bank, and whether a sync is running. */
  list(): Observable<AccountsResponse> {
    return this.http.get<AccountsResponse>('/api/accounts');
  }
}
