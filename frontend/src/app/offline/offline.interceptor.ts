import {
  HttpErrorResponse,
  HttpEventType,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
  type HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import {
  type Observable,
  catchError,
  defer,
  filter,
  from,
  of,
  switchMap,
  throwError,
  timeout,
} from 'rxjs';
import { OFFLINE_TIMEOUT_MS, Offline, isOfflineFailure } from './offline.service';
import { savedResponse } from './saved-data';

/**
 * A read from the API. Every read is timed out (ADR 0017), the auth check included: on a fresh
 * start the route guard waits on `/api/auth/me`, and off the tailnet that request can hang for a
 * long time. The health check has its own timeout (`Offline.check`).
 */
function isRead(request: HttpRequest<unknown>): boolean {
  return request.method === 'GET' && request.url !== '/api/health';
}

/** Answers from saved data; a read that was never saved fails as if there were no response. */
function fromSaved(request: HttpRequest<unknown>): Observable<HttpResponse<unknown>> {
  return defer(async () => {
    const saved = await savedResponse(request);
    if (saved) return saved;
    throw new HttpErrorResponse({
      status: 0,
      url: request.urlWithParams,
      statusText: 'Offline',
    });
  });
}

/**
 * Finds out when the app is offline and, once it is, answers reads from saved data at once
 * (ADR 0017).
 *
 * Reads wait about 3 seconds for the server; a read that gets no answer in time, no response, or
 * a 502, 503 or 504 makes the app offline and is answered from saved data instead, if there is
 * any. A read with nothing saved (the auth check, for one) fails as if there were no response,
 * at once while offline, so the route guard never waits on a server that is not there. Changes
 * are never timed out or answered from saved data, but a change that cannot reach the server
 * still shows the app is offline. Any other error, a 401 included, is left to the caller.
 *
 * When the app starts, reads are answered from saved data at once too, until the server has
 * answered `Offline.check`; then every read is fetched again in the background (ADR 0018). A read
 * with nothing saved goes to the server as usual.
 *
 * Saved data is read with `caches.match`. The service worker's own fallback is not enough: its
 * freshness strategy waits for every request and cannot be switched to saved data first.
 */
export const offlineInterceptor: HttpInterceptorFn = (request, next) => {
  const offline = inject(Offline);

  if (!request.url.startsWith('/api/')) return next(request);

  if (!isRead(request)) {
    return next(request).pipe(
      catchError((error: unknown) => {
        if (isOfflineFailure(error)) offline.markOffline();
        return throwError(() => error);
      }),
    );
  }

  if (offline.isOffline()) return fromSaved(request);

  if (offline.isStarting()) {
    return from(savedResponse(request)).pipe(
      switchMap((saved): Observable<HttpEvent<unknown>> => {
        // The server may have answered while saved data was being looked up.
        if (!saved || !offline.isStarting()) return fromServer(request, next, offline);
        offline.showedSavedData();
        return of(saved);
      }),
    );
  }

  return fromServer(request, next, offline);
};

/** Asks the server, and falls back to saved data when it cannot answer. */
function fromServer(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  offline: Offline,
): Observable<HttpEvent<unknown>> {
  return next(request).pipe(
    // The backend announces `Sent` at once, which says nothing about the server answering.
    filter((event) => event.type !== HttpEventType.Sent),
    timeout({ first: OFFLINE_TIMEOUT_MS }),
    catchError((error: unknown) => {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      if (!timedOut && !isOfflineFailure(error)) return throwError(() => error);
      offline.markOffline();
      // A slow answer is not proof of being offline: ask at once, so saved data does not stay on
      // screen for a server that is in fact there.
      if (timedOut) void offline.check();
      return fromSaved(request).pipe(
        catchError(() =>
          throwError(() =>
            error instanceof HttpErrorResponse
              ? error
              : new HttpErrorResponse({
                  status: 0,
                  url: request.urlWithParams,
                  statusText: 'Offline',
                }),
          ),
        ),
      );
    }),
  );
}
