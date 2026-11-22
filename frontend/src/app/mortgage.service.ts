import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AddLoanPartRequest,
  AmortisationChangeRequest,
  EndLoanPartRequest,
  InterestRateChangeRequest,
  MortgageFiguresResponse,
  MortgageEntryRequest,
  MortgageResponse,
  UpdateLoanPartRequest,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';

const BASE = '/api/mortgage';

/** Every call returns the whole mortgage as it is afterwards. */
@Injectable({ providedIn: 'root' })
export class MortgageService {
  private readonly http = inject(HttpClient);

  get(): Observable<MortgageResponse> {
    return this.http.get<MortgageResponse>(BASE);
  }

  /** Remaining debt now, and the estimate and what was paid per month. */
  figures(): Observable<MortgageFiguresResponse> {
    return this.http.get<MortgageFiguresResponse>(`${BASE}/figures`);
  }

  addPart(request: AddLoanPartRequest): Observable<MortgageResponse> {
    return this.http.post<MortgageResponse>(`${BASE}/parts`, request);
  }

  updatePart(id: number, request: UpdateLoanPartRequest): Observable<MortgageResponse> {
    return this.http.put<MortgageResponse>(`${BASE}/parts/${id}`, request);
  }

  endPart(id: number, request: EndLoanPartRequest): Observable<MortgageResponse> {
    return this.http.post<MortgageResponse>(`${BASE}/parts/${id}/end`, request);
  }

  addRateChange(id: number, request: InterestRateChangeRequest): Observable<MortgageResponse> {
    return this.http.post<MortgageResponse>(`${BASE}/parts/${id}/rate-changes`, request);
  }

  addAmortisationChange(
    id: number,
    request: AmortisationChangeRequest,
  ): Observable<MortgageResponse> {
    return this.http.post<MortgageResponse>(`${BASE}/parts/${id}/amortisation-changes`, request);
  }

  addEntry(request: MortgageEntryRequest): Observable<MortgageResponse> {
    return this.http.post<MortgageResponse>(`${BASE}/entries`, request);
  }

  updateEntry(id: number, request: MortgageEntryRequest): Observable<MortgageResponse> {
    return this.http.put<MortgageResponse>(`${BASE}/entries/${id}`, request);
  }

  deleteEntry(id: number): Observable<MortgageResponse> {
    return this.http.delete<MortgageResponse>(`${BASE}/entries/${id}`);
  }
}
