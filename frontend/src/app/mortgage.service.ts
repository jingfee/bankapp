import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { MortgageFiguresResponse, MortgageResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

const BASE = '/api/mortgage';

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
}
