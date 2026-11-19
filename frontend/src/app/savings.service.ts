import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { SavingsResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SavingsService {
  private readonly http = inject(HttpClient);

  /** Every savings account with its monthly history, the current totals and reminders. */
  get(): Observable<SavingsResponse> {
    return this.http.get<SavingsResponse>('/api/savings');
  }
}
