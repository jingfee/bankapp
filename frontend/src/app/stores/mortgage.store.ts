import { HttpClient } from '@angular/common/http';
import { Injectable, forwardRef, inject, signal } from '@angular/core';
import type {
  AddLoanPartRequest,
  AmortisationChangeRequest,
  EndLoanPartRequest,
  InterestRateChangeRequest,
  MortgageEntryRequest,
  MortgageFiguresResponse,
  MortgageResponse,
  UpdateLoanPartRequest,
} from '@bankapp/shared';
import { type Observable, tap } from 'rxjs';
import { Invalidation } from './invalidation';
import { type ParamRead, paramRead } from './kept';

/**
 * The mortgage, what it adds up to, and its mutations. Both reads are live only for as long as
 * the page that asked: call them where the page is created. The `mortgage` fact refreshes
 * both, and `transactions` the figures (a categorised payment changes what was paid). Every
 * mutation returns the whole mortgage as it is afterwards.
 */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpMortgageStore) })
export abstract class MortgageStore {
  /** The loan parts and the entries of their debt. */
  abstract mortgage(): ParamRead<MortgageResponse>;
  /** Remaining debt now, and the estimate and what was paid per month. */
  abstract figures(): ParamRead<MortgageFiguresResponse>;

  abstract addPart(request: AddLoanPartRequest): Observable<MortgageResponse>;
  abstract updatePart(id: number, request: UpdateLoanPartRequest): Observable<MortgageResponse>;
  abstract endPart(id: number, request: EndLoanPartRequest): Observable<MortgageResponse>;
  abstract addRateChange(
    id: number,
    request: InterestRateChangeRequest,
  ): Observable<MortgageResponse>;
  abstract addAmortisationChange(
    id: number,
    request: AmortisationChangeRequest,
  ): Observable<MortgageResponse>;
  abstract addEntry(request: MortgageEntryRequest): Observable<MortgageResponse>;
  abstract updateEntry(id: number, request: MortgageEntryRequest): Observable<MortgageResponse>;
  abstract deleteEntry(id: number): Observable<MortgageResponse>;
}

const BASE = '/api/mortgage';

@Injectable()
export class HttpMortgageStore extends MortgageStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);

  mortgage(): ParamRead<MortgageResponse> {
    return paramRead<true, MortgageResponse>(
      signal<true>(true),
      () => ({ url: BASE }),
      this.invalidation.version('mortgage'),
    );
  }

  figures(): ParamRead<MortgageFiguresResponse> {
    return paramRead<true, MortgageFiguresResponse>(
      signal<true>(true),
      () => ({ url: `${BASE}/figures` }),
      this.invalidation.version('mortgageFigures'),
    );
  }

  private changed(call: Observable<MortgageResponse>): Observable<MortgageResponse> {
    return call.pipe(tap(() => this.invalidation.fire('mortgage')));
  }

  addPart(request: AddLoanPartRequest): Observable<MortgageResponse> {
    return this.changed(this.http.post<MortgageResponse>(`${BASE}/parts`, request));
  }

  updatePart(id: number, request: UpdateLoanPartRequest): Observable<MortgageResponse> {
    return this.changed(this.http.put<MortgageResponse>(`${BASE}/parts/${id}`, request));
  }

  endPart(id: number, request: EndLoanPartRequest): Observable<MortgageResponse> {
    return this.changed(this.http.post<MortgageResponse>(`${BASE}/parts/${id}/end`, request));
  }

  addRateChange(id: number, request: InterestRateChangeRequest): Observable<MortgageResponse> {
    return this.changed(
      this.http.post<MortgageResponse>(`${BASE}/parts/${id}/rate-changes`, request),
    );
  }

  addAmortisationChange(
    id: number,
    request: AmortisationChangeRequest,
  ): Observable<MortgageResponse> {
    return this.changed(
      this.http.post<MortgageResponse>(`${BASE}/parts/${id}/amortisation-changes`, request),
    );
  }

  addEntry(request: MortgageEntryRequest): Observable<MortgageResponse> {
    return this.changed(this.http.post<MortgageResponse>(`${BASE}/entries`, request));
  }

  updateEntry(id: number, request: MortgageEntryRequest): Observable<MortgageResponse> {
    return this.changed(this.http.put<MortgageResponse>(`${BASE}/entries/${id}`, request));
  }

  deleteEntry(id: number): Observable<MortgageResponse> {
    return this.changed(this.http.delete<MortgageResponse>(`${BASE}/entries/${id}`));
  }
}
