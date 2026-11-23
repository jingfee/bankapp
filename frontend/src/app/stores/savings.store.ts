import { HttpClient } from '@angular/common/http';
import { Injectable, forwardRef, inject, signal } from '@angular/core';
import type {
  BalanceEntryRequest,
  CloseManualSavingsAccountRequest,
  ManualSavingsAccount,
  ManualSavingsAccountRequest,
  ManualSavingsResponse,
  SavingsResponse,
} from '@bankapp/shared';
import { type Observable, tap } from 'rxjs';
import { Invalidation } from './invalidation';
import { type ParamRead, paramRead } from './kept';

/**
 * The savings overview, the manual savings accounts and the mutations of the latter. Both reads
 * are live only for as long as the page that asked: call them where the page is created. The
 * `savings` fact refreshes both, and `accounts` the overview. Each mutation returns the account
 * as it is afterwards.
 */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpSavingsStore) })
export abstract class SavingsStore {
  /** Every savings account with its monthly history, the current totals and reminders. */
  abstract savings(): ParamRead<SavingsResponse>;
  /** The manual savings accounts with their entries. */
  abstract manualSavings(): ParamRead<ManualSavingsResponse>;

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

  savings(): ParamRead<SavingsResponse> {
    return paramRead<true, SavingsResponse>(
      signal<true>(true),
      () => ({ url: '/api/savings' }),
      this.invalidation.version('savings'),
    );
  }

  manualSavings(): ParamRead<ManualSavingsResponse> {
    return paramRead<true, ManualSavingsResponse>(
      signal<true>(true),
      () => ({ url: BASE }),
      this.invalidation.version('manualSavings'),
    );
  }

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
