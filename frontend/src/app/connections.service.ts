import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { StartConnectionRequest, StartConnectionResponse } from '@bankapp/shared';
import { type Observable, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ConnectionsService {
  private readonly http = inject(HttpClient);

  /** Starts a BankID login for the bank; emits the URL to send the owner to. */
  start(bank: string): Observable<string> {
    return this.http
      .post<StartConnectionResponse>('/api/connections', { bank } satisfies StartConnectionRequest)
      .pipe(map((response) => response.url));
  }
}
