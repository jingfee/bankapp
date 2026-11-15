import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { LoginRequest, MeResponse } from '@bankapp/shared';
import { type Observable, catchError, map, of, tap } from 'rxjs';

/** Whether the owner is signed in, as far as the server has told us. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private signedIn = false;

  /** Asks the server whether the session cookie is still good; remembered once it is. */
  check(): Observable<boolean> {
    if (this.signedIn) return of(true);
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
    return this.http.post<void>('/api/auth/login', request).pipe(tap(() => (this.signedIn = true)));
  }

  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {}).pipe(
      // Only a session the server has ended counts as logged out; if the request fails the
      // session is still live, so the error goes to the caller instead of pretending.
      tap(() => this.markSignedOut()),
    );
  }

  /** The session is over, by logout or because the server rejected it. */
  markSignedOut(): void {
    this.signedIn = false;
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
