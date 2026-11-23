import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, type Signal, computed, forwardRef, inject, signal } from '@angular/core';
import type {
  CloseMonthRequest,
  SetBalanceSettingRequest,
  SetOpenMonthRequest,
  SettlementResponse,
} from '@bankapp/shared';
import { type Observable, tap } from 'rxjs';
import { Invalidation } from './invalidation';
import { keptValue } from './kept';

@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpSettlementStore) })
export abstract class SettlementStore {
  /**
   * The balance, its settlement periods and the balance settings. A refresh that fails keeps
   * what was fetched before; undefined until the first fetch succeeds.
   */
  abstract readonly settlement: Signal<SettlementResponse | undefined>;
  /** True while the first fetch is under way. */
  abstract readonly loading: Signal<boolean>;
  /** True when the settlement could not be fetched and there is nothing older to show. */
  abstract readonly failed: Signal<boolean>;
  /** Starts fetching the settlement, for as long as a page shows it. */
  abstract activate(): void;
  /** Stops fetching and forgets the settlement. */
  abstract deactivate(): void;

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

  private readonly active = signal(false);
  private readonly resource = httpResource<SettlementResponse>(() =>
    this.active() ? '/api/settlement' : undefined,
  );

  readonly settlement = keptValue(this.resource, this.active);
  readonly loading = computed(() => this.resource.isLoading() && this.settlement() === undefined);
  readonly failed = computed(
    () => this.resource.status() === 'error' && this.settlement() === undefined,
  );

  constructor() {
    super();
    this.invalidation.onRead('settlement', () => this.resource.reload());
  }

  activate(): void {
    this.active.set(true);
  }

  deactivate(): void {
    this.active.set(false);
  }

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
