import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OFFLINE_TIMEOUT_MS, Offline } from './offline.service';
import { offlineInterceptor } from './offline.interceptor';

describe('offlineInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let offline: Offline;
  let saved: Map<string, unknown>;

  /** What the service worker has saved, by URL. */
  function save(url: string, body: unknown) {
    saved.set(url, body);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    saved = new Map();
    vi.stubGlobal('caches', {
      match: (url: string) =>
        Promise.resolve(
          saved.has(url)
            ? new Response(JSON.stringify(saved.get(url)), { status: 200 })
            : undefined,
        ),
    });
    // The background check must not reach a real network.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([offlineInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    offline = TestBed.inject(Offline);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The result of a read: its body, or the status of the error. */
  async function read(url: string): Promise<unknown> {
    const result = new Promise((resolve) =>
      http.get(url).subscribe({
        next: resolve,
        error: (error: { status: number }) => resolve({ failedWith: error.status }),
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    return result;
  }

  describe('which failures mean offline', () => {
    it.each([502, 503, 504])('goes offline on a %s', async (status) => {
      const result = read('/api/settlement');
      backend.expectOne('/api/settlement').flush(null, { status, statusText: 'x' });

      expect(await result).toEqual({ failedWith: status });
      expect(offline.isOffline()).toBe(true);
    });

    it('goes offline when there is no response at all', async () => {
      const result = read('/api/settlement');
      backend.expectOne('/api/settlement').error(new ProgressEvent('error'));

      expect(await result).toEqual({ failedWith: 0 });
      expect(offline.isOffline()).toBe(true);
    });

    it.each([401, 404, 500])('stays online on a %s', async (status) => {
      const result = read('/api/settlement');
      backend.expectOne('/api/settlement').flush(null, { status, statusText: 'x' });

      expect(await result).toEqual({ failedWith: status });
      expect(offline.isOffline()).toBe(false);
    });

    it('goes offline when a change cannot reach the server, and leaves the error to the caller', async () => {
      const result = new Promise((resolve) =>
        http
          .post('/api/sync', null)
          .subscribe({ error: (e: { status: number }) => resolve(e.status) }),
      );
      backend.expectOne('/api/sync').flush(null, { status: 503, statusText: 'x' });

      expect(await result).toBe(503);
      expect(offline.isOffline()).toBe(true);
    });
  });

  describe('the timeout', () => {
    it('decides offline when a read has not been answered after about 3 seconds', async () => {
      save('/api/settlement', { balance: 5 });
      const result = read('/api/settlement');
      backend.expectOne('/api/settlement');

      await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS - 1);
      expect(offline.isOffline()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(offline.isOffline()).toBe(true);
      // The read that timed out gets what was saved instead of an error.
      expect(await result).toEqual({ balance: 5 });
    });

    it('asks the server at once after a timeout, so a slow server is not left offline', async () => {
      const asked = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
      vi.stubGlobal('fetch', asked);
      const result = read('/api/settlement');
      backend.expectOne('/api/settlement');

      await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS);

      expect(asked).toHaveBeenCalledWith('/api/health', expect.anything());
      expect(offline.isOffline()).toBe(false);
      await result;
    });

    it('times out the auth check too, so a fresh start does not wait on a server that is not there', async () => {
      const result = read('/api/auth/me');
      backend.expectOne('/api/auth/me');

      await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS);

      expect(offline.isOffline()).toBe(true);
      expect(await result).toEqual({ failedWith: 0 });
    });

    it('does not time out a change, which may take long', async () => {
      http.post('/api/sync', null).subscribe();
      backend.expectOne('/api/sync');

      await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS * 3);

      expect(offline.isOffline()).toBe(false);
    });

    it('does not decide offline when the server answers in time', async () => {
      const result = read('/api/settlement');
      backend.expectOne('/api/settlement').flush({ balance: 1 });
      await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS * 2);

      expect(await result).toEqual({ balance: 1 });
      expect(offline.isOffline()).toBe(false);
    });
  });

  describe('while offline', () => {
    beforeEach(() => offline.markOffline());

    it('shows saved data straight away, without asking the server', async () => {
      save('/api/overview?month=2026-11&view=mine', { total: 10 });

      const result = await read('/api/overview?month=2026-11&view=mine');

      expect(result).toEqual({ total: 10 });
      backend.expectNone(() => true);
    });

    it('fails with no response for a read that was never saved', async () => {
      expect(await read('/api/transactions?q=ica')).toEqual({ failedWith: 0 });
      backend.expectNone(() => true);
    });

    it('fails the auth check at once, never from saved data', async () => {
      save('/api/auth/me', { username: 'owner' });

      expect(await read('/api/auth/me')).toEqual({ failedWith: 0 });
      backend.expectNone(() => true);
    });

    it('does not answer a change from saved data', async () => {
      save('/api/sync', { ok: true });
      http.post('/api/sync', null).subscribe({ error: () => undefined });
      await vi.advanceTimersByTimeAsync(0);

      backend.expectOne('/api/sync').flush(null, { status: 503, statusText: 'x' });
    });
  });

  it('leaves what is not the API alone', async () => {
    const result = read('/assets/x.json');
    backend.expectOne('/assets/x.json').flush({ a: 1 });
    await vi.advanceTimersByTimeAsync(OFFLINE_TIMEOUT_MS * 2);

    expect(await result).toEqual({ a: 1 });
    expect(offline.isOffline()).toBe(false);
  });
});
