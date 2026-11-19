import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  BalanceEntryRequest,
  CloseManualSavingsAccountRequest,
  ManualSavingsAccount,
  ManualSavingsAccountRequest,
  ManualSavingsResponse,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';

const BASE = '/api/manual-savings-accounts';

@Injectable({ providedIn: 'root' })
export class ManualSavingsService {
  private readonly http = inject(HttpClient);

  list(): Observable<ManualSavingsResponse> {
    return this.http.get<ManualSavingsResponse>(BASE);
  }

  create(request: ManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.http.post<ManualSavingsAccount>(BASE, request);
  }

  rename(id: number, request: ManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.http.put<ManualSavingsAccount>(`${BASE}/${id}`, request);
  }

  close(id: number, request: CloseManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.http.post<ManualSavingsAccount>(`${BASE}/${id}/close`, request);
  }

  reopen(id: number): Observable<ManualSavingsAccount> {
    return this.http.post<ManualSavingsAccount>(`${BASE}/${id}/reopen`, {});
  }

  addEntry(id: number, request: BalanceEntryRequest): Observable<ManualSavingsAccount> {
    return this.http.post<ManualSavingsAccount>(`${BASE}/${id}/entries`, request);
  }

  updateEntry(
    id: number,
    entryId: number,
    request: BalanceEntryRequest,
  ): Observable<ManualSavingsAccount> {
    return this.http.put<ManualSavingsAccount>(`${BASE}/${id}/entries/${entryId}`, request);
  }

  deleteEntry(id: number, entryId: number): Observable<ManualSavingsAccount> {
    return this.http.delete<ManualSavingsAccount>(`${BASE}/${id}/entries/${entryId}`);
  }
}
