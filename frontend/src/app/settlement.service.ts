import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  SetBalanceSettingRequest,
  SettlementBalanceResponse,
  SettlementResponse,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettlementService {
  private readonly http = inject(HttpClient);

  /** The balance, its settlement periods and the balance settings. */
  get(): Observable<SettlementResponse> {
    return this.http.get<SettlementResponse>('/api/settlement');
  }

  /** Just the balance, for the start page's card. */
  balance(): Observable<SettlementBalanceResponse> {
    return this.http.get<SettlementBalanceResponse>('/api/settlement/balance');
  }

  /** States the balance as of a day (today when left out). */
  setBalance(request: SetBalanceSettingRequest): Observable<SettlementResponse> {
    return this.http.post<SettlementResponse>('/api/settlement/balance-settings', request);
  }
}
