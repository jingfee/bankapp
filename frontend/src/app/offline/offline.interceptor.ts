import {
  HttpErrorResponse,
  HttpHeaders,
  HttpEventType,
  type HttpInterceptorFn,
  type HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { type Observable, catchError, defer, filter, throwError, timeout } from 'rxjs';
import { OFFLINE_TIMEOUT_MS, Offline, isOfflineFailure } from './offline.service';

/**
 * A read the service worker may have saved. The health check and the auth calls are never saved
 * (see `ngsw-config.json`), so they are never timed out or answered from saved data.
 */
function isSavedRead(request: HttpRequest<unknown>): boolean {
  return (
    request.method === 'GET' &&
    request.url.startsWith('/api/') &&
    request.url !== '/api/health' &&
    !request.url.startsWith('/api/auth/')
  );
}

/** What the device has saved for the request, or `undefined` if it never fetched it. */
async function savedResponse(
  request: HttpRequest<unknown>,
): Promise<HttpResponse<unknown> | undefined> {
  if (typeof caches === 'undefined') return undefined;
  try {
    const saved = await caches.match(request.urlWithParams);
    if (!saved) return undefined;
    const text = await saved.text();
    // The saved response's `Date` is when the device fetched it; pages show it (`fetchedAt`).
    const date = saved.headers.get('Date');
    return new HttpResponse({
      headers: new HttpHeaders(date ? { Date: date } : {}),
      body: text === '' ? null : (JSON.parse(text) as unknown),
      status: saved.status,
      url: request.urlWithParams,
    });
  } catch {
    return undefined;
  }
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
 * any. Changes are never timed out or answered from saved data, but a change that cannot reach
 * the server still shows the app is offline. Any other error, a 401 included, is left to the
 * caller.
 *
 * Saved data is what the service worker keeps (`ngsw-config.json`), read with `caches.match`. The
 * service worker's own fallback is not enough: its freshness strategy waits for every request
 * and cannot be switched to saved data first once the app knows the server is gone.
 */
export const offlineInterceptor: HttpInterceptorFn = (request, next) => {
  const offline = inject(Offline);

  if (!request.url.startsWith('/api/')) return next(request);

  if (!isSavedRead(request)) {
    return next(request).pipe(
      catchError((error: unknown) => {
        if (isOfflineFailure(error)) offline.markOffline();
        return throwError(() => error);
      }),
    );
  }

  if (offline.isOffline()) return fromSaved(request);

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
};
