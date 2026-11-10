import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { StartSyncResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly http = inject(HttpClient);

  /** Starts a manual sync; progress is read from the accounts. */
  start(): Observable<StartSyncResponse> {
    return this.http.post<StartSyncResponse>('/api/sync', null);
  }
}
