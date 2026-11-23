import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { ManualSavingsResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

const BASE = '/api/manual-savings-accounts';

@Injectable({ providedIn: 'root' })
export class ManualSavingsService {
  private readonly http = inject(HttpClient);

  list(): Observable<ManualSavingsResponse> {
    return this.http.get<ManualSavingsResponse>(BASE);
  }
}
