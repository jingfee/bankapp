import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AccountsResponse } from '@bankapp/shared';
import { BanksStore, SYNC_POLL_INTERVAL_MS } from './banks.store';
import { Invalidation } from './invalidation';

const accounts = (syncing: 'manual' | 'scheduled' | null): AccountsResponse =>
  ({ syncing, lastSync: null, banks: [] }) as unknown as AccountsResponse;

describe('BanksStore sync status', () => {
  let store: BanksStore;
  let http: HttpTestingController;
  let fired: number;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(BanksStore);
    http = TestBed.inject(HttpTestingController);
    fired = 0;
    TestBed.inject(Invalidation).onRead('banks', () => fired++);
  });

  afterEach(() => vi.useRealTimers());

  /** Starts following the accounts and answers the first fetch. */
  async function follow(first: AccountsResponse): Promise<void> {
    store.loadOnce();
    await settle();
    http.expectOne('/api/accounts').flush(first);
    await settle();
  }

  /** Lets the effects and promises run, which fake timers do not do on their own. */
  async function settle(): Promise<void> {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    TestBed.tick();
  }

  /** Lets one poll interval pass and answers the fetch it makes. */
  async function poll(answer: (request: TestRequest) => void): Promise<void> {
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
    TestBed.tick();
    answer(http.expectOne('/api/accounts'));
    await settle();
  }

  it('reports the status held by the accounts', async () => {
    await follow({
      syncing: null,
      lastSync: { failedAccounts: 1, rateLimited: false },
      banks: [
        { status: 'expired', accounts: [{ lastSyncedAt: '2026-11-01T10:00:00Z' }] },
        { status: 'active', accounts: [{ lastSyncedAt: '2026-11-02T10:00:00Z' }] },
      ],
    } as unknown as AccountsResponse);
    expect(store.lastSyncedAt()).toBe('2026-11-02T10:00:00Z');
    expect(store.lastFailed()).toBe(true);
    expect(store.expiringCount()).toBe(1);
  });

  it('fetches the accounts once, however often it is asked to load', async () => {
    store.loadOnce();
    store.loadOnce();
    await settle();
    http.expectOne('/api/accounts').flush(accounts(null));
    await settle();
    store.loadOnce();
    http.expectNone('/api/accounts');
  });

  it('does not fetch anything before it is asked to load', async () => {
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
  });

  it('does nothing while no sync is running', async () => {
    await follow(accounts(null));
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
    expect(fired).toBe(0);
  });

  it('polls while a sync runs and fires banks once when it has finished', async () => {
    await follow(accounts('scheduled'));
    expect(fired).toBe(0);

    await poll((request) => request.flush(accounts('scheduled')));
    expect(fired).toBe(0);

    await poll((request) => request.flush(accounts(null)));
    expect(fired).toBe(1);

    // Banks changed, so the accounts are fetched once more; that is the last request.
    http.expectOne('/api/accounts').flush(accounts(null));
    await settle();
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
  });

  it('follows a sync it starts, and fetches the accounts again at once', async () => {
    await follow(accounts(null));
    store.startSync().subscribe();
    http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
    await settle();
    http.expectOne('/api/accounts').flush(accounts('manual'));
    await settle();

    await poll((request) => request.flush(accounts(null)));
    expect(fired).toBe(1);
  });

  it('does not call a sync finished before the server has shown it running', async () => {
    await follow(accounts(null));
    store.startSync().subscribe();
    http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
    await settle();
    http.expectOne('/api/accounts').flush(accounts(null));
    await settle();
    expect(fired).toBe(0);

    await poll((request) => request.flush(accounts('manual')));
    await poll((request) => request.flush(accounts(null)));
    expect(fired).toBe(1);
  });

  it('gives up waiting for a started sync to show up', async () => {
    await follow(accounts(null));
    store.startSync().subscribe();
    http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
    await settle();
    http.expectOne('/api/accounts').flush(accounts(null));
    await settle();
    for (let i = 0; i < 5; i++) await poll((request) => request.flush(accounts(null)));
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
  });

  it('keeps polling after a failed poll', async () => {
    await follow(accounts('manual'));
    await poll((request) => request.flush('x', { status: 500, statusText: 'x' }));
    await poll((request) => request.flush(accounts(null)));
    expect(fired).toBe(1);
  });

  it('keeps polling when the fetch after starting a sync fails', async () => {
    await follow(accounts(null));
    store.startSync().subscribe();
    http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
    await settle();
    http.expectOne('/api/accounts').error(new ProgressEvent('error'));
    await settle();

    await poll((request) => request.flush(accounts('manual')));
    await poll((request) => request.flush(accounts(null)));
    expect(fired).toBe(1);
  });

  it('stops following a sync when the owner logs out', async () => {
    await follow(accounts('manual'));
    store.reset();
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
    expect(fired).toBe(0);
    expect(store.expiringCount()).toBe(0);
  });

  it('works out how long a connection has left', () => {
    const inDays = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    expect(store.daysLeft(inDays(60))).toBe(60);
    expect(store.daysLeft(inDays(0.5))).toBe(1);
    expect(store.daysLeft(inDays(-2))).toBe(1);
    expect(store.connectionLeft(inDays(45))).toBeCloseTo(0.5);
    expect(store.connectionLeft(inDays(200))).toBe(1);
    expect(store.connectionLeft(inDays(-2))).toBe(0);
  });
});
