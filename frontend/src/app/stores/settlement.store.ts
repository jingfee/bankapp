import { HttpClient } from '@angular/common/http';
import { Injectable, forwardRef, inject } from '@angular/core';
import type {
  CloseMonthRequest,
  SetBalanceSettingRequest,
  SetOpenMonthRequest,
  SettlementResponse,
} from '@bankapp/shared';
import { type Observable, tap } from 'rxjs';
import { Invalidation } from './invalidation';

@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpSettlementStore) })
export abstract class SettlementStore {
  /** States the balance as of a day (today when left out). */
  abstract setBalance(request: SetBalanceSettingRequest): Observable<SettlementResponse>;
  /** Closes the open period and opens the next month. */
  abstract close(request: CloseMonthRequest): Observable<SettlementResponse>;
  /** Undoes the latest close. */
  abstract undoClose(): Observable<SettlementResponse>;
  /** Saves a closed month's Excel report again, with the current figures. */
  abstract saveReport(month: string): Observable<SettlementResponse>;
  /** Renames the open period's month. */
  abstract setOpenMonth(request: SetOpenMonthRequest): Observable<SettlementResponse>;
}

@Injectable()
export class HttpSettlementStore extends SettlementStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);

  private changed(call: Observable<SettlementResponse>): Observable<SettlementResponse> {
    return call.pipe(tap(() => this.invalidation.fire('settlement')));
  }

  setBalance(request: SetBalanceSettingRequest): Observable<SettlementResponse> {
    return this.changed(
      this.http.post<SettlementResponse>('/api/settlement/balance-settings', request),
    );
  }

  close(request: CloseMonthRequest): Observable<SettlementResponse> {
    return this.changed(this.http.post<SettlementResponse>('/api/settlement/close', request));
  }

  undoClose(): Observable<SettlementResponse> {
    return this.changed(this.http.post<SettlementResponse>('/api/settlement/undo-close', {}));
  }

  saveReport(month: string): Observable<SettlementResponse> {
    return this.changed(
      this.http.post<SettlementResponse>(`/api/settlement/periods/${month}/report`, {}),
    );
  }

  setOpenMonth(request: SetOpenMonthRequest): Observable<SettlementResponse> {
    return this.changed(this.http.put<SettlementResponse>('/api/settlement/month', request));
  }
}
