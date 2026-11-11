import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { StartConnectionRequest, StartConnectionResponse } from '@bankapp/shared';
import { type Observable, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ConnectionsService {
  private readonly http = inject(HttpClient);

  /**
   * Starts a BankID login for the bank; emits the URL to send the owner to. `renew` asks to
   * renew a connection that is still active.
   */
  start(bank: string, renew = false): Observable<string> {
    const body: StartConnectionRequest = renew ? { bank, renew } : { bank };
    return this.http
      .post<StartConnectionResponse>('/api/connections', body)
      .pipe(map((response) => response.url));
  }
}
