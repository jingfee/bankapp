import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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

  it('reports the status held by an accounts response', () => {
    store.reportAccounts({
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

  it('loads the status once, unless something has reported it', () => {
    store.loadOnce();
    store.loadOnce();
    http.expectOne('/api/accounts').flush(accounts(null));
    store.loadOnce();
    http.expectNone('/api/accounts');
  });

  it('does nothing while no sync is running', async () => {
    store.reportAccounts(accounts(null));
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
    expect(fired).toBe(0);
  });

  it('polls while a sync runs and fires banks once when it has finished', async () => {
    store.reportAccounts(accounts('scheduled'));
    expect(fired).toBe(0);

    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 2);
    http.expectOne('/api/accounts').flush(accounts('scheduled'));
    expect(fired).toBe(0);

    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 2);
    http.expectOne('/api/accounts').flush(accounts(null));
    expect(fired).toBe(1);

    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
  });

  it('leaves the polling to a page that keeps reporting, and still fires banks at the end', async () => {
    for (let i = 0; i < 4; i++) {
      store.reportAccounts(accounts('manual'));
      await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
    }
    http.expectNone('/api/accounts');
    store.reportAccounts(accounts(null));
    expect(fired).toBe(1);
  });

  it('keeps polling after a failed poll', async () => {
    store.reportAccounts(accounts('manual'));
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 2);
    http.expectOne('/api/accounts').flush('x', { status: 500, statusText: 'x' });
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 2);
    http.expectOne('/api/accounts').flush(accounts(null));
    expect(fired).toBe(1);
  });

  it('ignores a poll that answers after the owner has logged out', async () => {
    store.reportAccounts(accounts('manual'));
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 2);
    const pending = http.expectOne('/api/accounts');
    store.reset();
    pending.flush('x', { status: 401, statusText: 'x' });
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
  });

  it('stops following a sync when the owner logs out', async () => {
    store.reportAccounts(accounts('manual'));
    store.reset();
    await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 5);
    http.expectNone('/api/accounts');
    expect(fired).toBe(0);
    expect(store.expiringCount()).toBe(0);
  });
});
