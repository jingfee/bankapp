import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { HealthResponse } from '@bankapp/shared';
import { type Observable, catchError, map, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  /** Emits whether the backend answered its health check. */
  isServerReachable(): Observable<boolean> {
    return this.http.get<HealthResponse>('/api/health').pipe(
      map((response) => response.status === 'ok'),
      catchError(() => of(false)),
    );
  }
}
