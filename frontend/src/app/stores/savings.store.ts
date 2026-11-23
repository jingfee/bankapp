import { HttpClient } from '@angular/common/http';
import { Injectable, forwardRef, inject } from '@angular/core';
import type {
  BalanceEntryRequest,
  CloseManualSavingsAccountRequest,
  ManualSavingsAccount,
  ManualSavingsAccountRequest,
} from '@bankapp/shared';
import { type Observable, tap } from 'rxjs';
import { Invalidation } from './invalidation';

/** The mutations of the manual savings accounts; each returns the account as it is afterwards. */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpSavingsStore) })
export abstract class SavingsStore {
  abstract create(request: ManualSavingsAccountRequest): Observable<ManualSavingsAccount>;
  abstract rename(
    id: number,
    request: ManualSavingsAccountRequest,
  ): Observable<ManualSavingsAccount>;
  abstract close(
    id: number,
    request: CloseManualSavingsAccountRequest,
  ): Observable<ManualSavingsAccount>;
  abstract reopen(id: number): Observable<ManualSavingsAccount>;
  abstract addEntry(id: number, request: BalanceEntryRequest): Observable<ManualSavingsAccount>;
  abstract updateEntry(
    id: number,
    entryId: number,
    request: BalanceEntryRequest,
  ): Observable<ManualSavingsAccount>;
  abstract deleteEntry(id: number, entryId: number): Observable<ManualSavingsAccount>;
}

const BASE = '/api/manual-savings-accounts';

@Injectable()
export class HttpSavingsStore extends SavingsStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);

  private changed(call: Observable<ManualSavingsAccount>): Observable<ManualSavingsAccount> {
    return call.pipe(tap(() => this.invalidation.fire('savings')));
  }

  create(request: ManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.changed(this.http.post<ManualSavingsAccount>(BASE, request));
  }

  rename(id: number, request: ManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.changed(this.http.put<ManualSavingsAccount>(`${BASE}/${id}`, request));
  }

  close(id: number, request: CloseManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.changed(this.http.post<ManualSavingsAccount>(`${BASE}/${id}/close`, request));
  }

  reopen(id: number): Observable<ManualSavingsAccount> {
    return this.changed(this.http.post<ManualSavingsAccount>(`${BASE}/${id}/reopen`, {}));
  }

  addEntry(id: number, request: BalanceEntryRequest): Observable<ManualSavingsAccount> {
    return this.changed(this.http.post<ManualSavingsAccount>(`${BASE}/${id}/entries`, request));
  }

  updateEntry(
    id: number,
    entryId: number,
    request: BalanceEntryRequest,
  ): Observable<ManualSavingsAccount> {
    return this.changed(
      this.http.put<ManualSavingsAccount>(`${BASE}/${id}/entries/${entryId}`, request),
    );
  }

  deleteEntry(id: number, entryId: number): Observable<ManualSavingsAccount> {
    return this.changed(this.http.delete<ManualSavingsAccount>(`${BASE}/${id}/entries/${entryId}`));
  }
}
