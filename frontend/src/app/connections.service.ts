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

  /**
   * Removes a bank the owner no longer uses; its history stays. The savings accounts in
   * `continueManually` carry on as manual savings accounts; the others close.
   */
  remove(bank: string, continueManually: number[] = []): Observable<void> {
    const params: Record<string, string> =
      continueManually.length > 0 ? { continueManually: continueManually.join(',') } : {};
    return this.http.delete<void>(`/api/connections/${encodeURIComponent(bank)}`, { params });
  }

  /** Erases a removed bank and everything it brought in (ADR 0013). */
  deleteForGood(bank: string): Observable<void> {
    return this.http.delete<void>(`/api/connections/${encodeURIComponent(bank)}/permanent`);
  }
}
