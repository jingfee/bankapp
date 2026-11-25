import { HttpHeaders, type HttpRequest, HttpResponse } from '@angular/common/http';

/** Saved data older than this is not shown (ADR 0017). */
export const SAVED_DATA_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** A read the warm-up always saves, so it is there whenever a session's data is. */
const SESSION_MARKER_URL = '/api/accounts';

/**
 * What the device has saved for a read, or `undefined` if it never fetched it or fetched it more
 * than 30 days ago. Saved data is what the service worker keeps (`ngsw-config.json`).
 */
export async function savedResponse(
  request: HttpRequest<unknown>,
): Promise<HttpResponse<unknown> | undefined> {
  if (typeof caches === 'undefined' || request.url.startsWith('/api/auth/')) return undefined;
  try {
    const saved = await caches.match(request.urlWithParams);
    if (!saved) return undefined;
    // The saved response's `Date` is when the device fetched it; pages show it (`fetchedAt`).
    const date = saved.headers.get('Date');
    if (date && Date.now() - new Date(date).getTime() > SAVED_DATA_MAX_AGE_MS) return undefined;
    const text = await saved.text();
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

/**
 * Whether the device holds a session's saved data. Logging out deletes it, so it means the owner
 * was signed in here and did not log out.
 */
export async function hasSavedData(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    return (await caches.match(SESSION_MARKER_URL)) !== undefined;
  } catch {
    return false;
  }
}
