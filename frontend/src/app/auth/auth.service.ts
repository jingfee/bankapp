import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { LoginRequest, MeResponse } from '@bankapp/shared';
import { type Observable, catchError, from, map, of, switchMap, tap, throwError } from 'rxjs';
import { Offline, isOfflineFailure } from '../offline/offline.service';
import { hasSavedData } from '../offline/saved-data';
import { Names } from '../names';
import { PendingLogout } from './pending-logout';

/** Whether the owner is signed in, as far as the server has told us. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly offline = inject(Offline);
  private readonly pending = inject(PendingLogout);
  private readonly names = inject(Names);
  private signedIn = false;

  /**
   * Asks the server whether the session cookie is still good; remembered once it is.
   *
   * While the app is starting, a device with saved data lets the owner in at once, without
   * waiting for the server (ADR 0018): logging out deletes saved data, so it means the owner was
   * signed in here. If the session has ended on the server, the background refresh gets a 401 and
   * the auth interceptor sends the owner to the login page.
   */
  check(): Observable<boolean> {
    // Signed out offline: the server session may still be live, but the owner chose to leave.
    if (this.pending.isPending()) return of(false);
    if (this.signedIn) return of(true);
    // No `caches`, no saved data: nothing to show before the server answers.
    if (!this.offline.isStarting() || typeof caches === 'undefined') return this.askServer();
    return from(hasSavedData()).pipe(switchMap((saved) => (saved ? of(true) : this.askServer())));
  }

  private askServer(): Observable<boolean> {
    return this.http.get<MeResponse>('/api/auth/me').pipe(
      tap(() => (this.signedIn = true)),
      map(() => true),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) return of(false);
        // Offline or a server hiccup says nothing about the session: let the owner into the app,
        // where cached pages work and any API call that really is unauthorised sends them to login.
        return of(true);
      }),
    );
  }

  login(request: LoginRequest): Observable<void> {
    return this.http.post<void>('/api/auth/login', request).pipe(
      tap(() => {
        this.signedIn = true;
        // A new session: ending "the" session later would end this one.
        this.pending.clear();
      }),
    );
  }

  /**
   * Online, the server ends the session and then saved data is deleted. Offline (or when the
   * server cannot be reached) saved data is deleted at once and the server is told on the next
   * reconnect (ADR 0017).
   */
  logout(): Observable<void> {
    if (this.offline.isOffline()) return of(this.logoutOffline());
    return this.http.post<void>('/api/auth/logout', {}).pipe(
      // Only a session the server has ended counts as logged out; if the request fails the
      // session is still live, so the error goes to the caller instead of pretending.
      tap(() => this.markSignedOut()),
      catchError((error: unknown) => {
        if (!isOfflineFailure(error)) return throwError(() => error);
        this.offline.markOffline();
        return of(this.logoutOffline());
      }),
    );
  }

  private logoutOffline(): void {
    this.pending.remember();
    this.markSignedOut();
  }

  /** The session is over, by logout or because the server rejected it. */
  markSignedOut(): void {
    this.signedIn = false;
    this.names.clear();
    void clearCachedData();
  }
}

/** The service worker keeps API responses for offline use; they must not outlive the session. */
async function clearCachedData(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    for (const name of await caches.keys()) {
      if (name.includes(':data:')) await caches.delete(name);
    }
  } catch {
    // Nothing to clear, or the browser forbids it.
  }
}
