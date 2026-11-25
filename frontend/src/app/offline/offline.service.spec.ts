import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { OfflineWarmup } from '../offline-warmup.service';
import { ALL_READS, Invalidation, type Read } from '../stores/invalidation';
import { Offline, RECHECK_INTERVAL_MS, isOfflineFailure } from './offline.service';

describe('isOfflineFailure', () => {
  const failure = (status: number) => new HttpErrorResponse({ status });

  it.each([0, 502, 503, 504])('counts a %s as offline', (status) => {
    expect(isOfflineFailure(failure(status))).toBe(true);
  });

  it.each([400, 401, 404, 500])('does not count a %s as offline', (status) => {
    expect(isOfflineFailure(failure(status))).toBe(false);
  });

  it('does not count something that is not a response', () => {
    expect(isOfflineFailure(new Error('boom'))).toBe(false);
  });
});

@Component({ template: '' })
class Blank {}

describe('Offline', () => {
  let offline: Offline;
  let fetchMock: ReturnType<typeof vi.fn>;
  let warmups: number;
  let refreshed: Read[];

  /** The server answers the health check with this status, or does not answer at all. */
  function serverAnswers(status: number | 'never') {
    fetchMock.mockImplementation(() =>
      status === 'never'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(new Response(null, { status })),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    warmups = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        { provide: OfflineWarmup, useValue: { rerun: () => warmups++ } },
      ],
    });
    offline = TestBed.inject(Offline);
    refreshed = [];
    const invalidation = TestBed.inject(Invalidation);
    for (const read of ALL_READS) invalidation.onRead(read, () => refreshed.push(read));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts out not offline', () => {
    expect(offline.isOffline()).toBe(false);
  });

  it('is offline from the first failing request', () => {
    offline.markOffline();

    expect(offline.isOffline()).toBe(true);
  });

  describe('while offline', () => {
    beforeEach(() => offline.markOffline());

    it('checks /api/health about every 30 seconds, until the server answers', async () => {
      serverAnswers('never');

      await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS - 1);
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(offline.isOffline()).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe('/api/health');
    });

    it('asks the server itself and never takes the answer from saved data', async () => {
      serverAnswers(200);

      await offline.check();

      expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
    });

    it('stays offline while the server answers with a 502, 503 or 504', async () => {
      for (const status of [502, 503, 504]) {
        serverAnswers(status);
        await offline.check();
        expect(offline.isOffline()).toBe(true);
      }
    });

    it('is back once the server answers, and refreshes every read and the warm-up', async () => {
      serverAnswers(200);

      await offline.check();

      expect(offline.isOffline()).toBe(false);
      expect([...refreshed].sort()).toEqual([...ALL_READS].sort());
      expect(warmups).toBe(1);
    });

    it('counts a 500 from the health check as the server answering', async () => {
      serverAnswers(500);

      await offline.check();

      expect(offline.isOffline()).toBe(false);
    });

    it('stops checking once it is back', async () => {
      serverAnswers(200);
      await offline.check();
      fetchMock.mockClear();

      await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS * 3);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not start a second check while one is waiting', async () => {
      fetchMock.mockImplementation(() => new Promise(() => undefined));

      void offline.check();
      void offline.check();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('gives up on a check the server never answers after about 3 seconds', async () => {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('', 'TimeoutError')),
            );
          }),
      );

      const check = offline.check();
      await vi.advanceTimersByTimeAsync(3000);
      await check;

      expect(offline.isOffline()).toBe(true);
    });

    it('checks at once when the app comes back to the foreground', async () => {
      offline.watch();
      serverAnswers(200);

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(offline.isOffline()).toBe(false);
    });

    it('does not check when the app goes to the background', async () => {
      offline.watch();
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('checks at once when the browser says it is online', async () => {
      offline.watch();
      serverAnswers(200);

      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(offline.isOffline()).toBe(false);
    });
  });

  describe('when the app starts', () => {
    it('checks the server once the owner is in the app, since the service worker can hide a dead network', async () => {
      offline.watch();
      serverAnswers('never');

      await TestBed.inject(Router).navigateByUrl('/');
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(offline.isOffline()).toBe(true);
    });

    it('refreshes every read and the warm-up when the server first answers, if saved data was shown', async () => {
      serverAnswers(200);
      offline.showedSavedData();

      await offline.check();

      expect(offline.isStarting()).toBe(false);
      expect([...refreshed].sort()).toEqual([...ALL_READS].sort());
      expect(warmups).toBe(1);
      offline.showedSavedData();
      await offline.check();
      expect(warmups).toBe(1);
    });

    it('is still starting while the server has not answered', async () => {
      serverAnswers('never');

      await offline.check();

      expect(offline.isStarting()).toBe(true);
      expect(offline.isOffline()).toBe(true);
    });

    it('does not warm up again when nothing was wrong', async () => {
      serverAnswers(200);

      await offline.check();

      expect(offline.isOffline()).toBe(false);
      expect(warmups).toBe(0);
      expect(refreshed).toEqual([]);
    });
  });
});
