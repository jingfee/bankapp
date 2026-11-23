import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AccountsResponse } from '@bankapp/shared';
import { AccountsStore } from './accounts.store';
import { Invalidation } from './invalidation';

const response = (syncing: 'manual' | null = null): AccountsResponse =>
  ({ syncing, lastSync: null, banks: [], removedBanks: [] }) as AccountsResponse;

describe('AccountsStore reads', () => {
  let store: AccountsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(AccountsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // whenStable would wait for the open request, so let the effects and promises run instead.
  const settle = async () => {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  it('fetches nothing until it is activated', async () => {
    await settle();
    http.expectNone('/api/accounts');
    expect(store.loading()).toBe(false);
  });

  it('fetches the accounts once activated, and is loading until they arrive', async () => {
    store.activate();
    await settle();
    expect(store.loading()).toBe(true);
    http.expectOne('/api/accounts').flush(response());
    await settle();
    expect(store.loading()).toBe(false);
    expect(store.accounts()).toEqual(response());
  });

  it('is failed when the first fetch fails', async () => {
    store.activate();
    await settle();
    http.expectOne('/api/accounts').error(new ProgressEvent('error'));
    await settle();
    expect(store.failed()).toBe(true);
    expect(store.accounts()).toBeUndefined();
  });

  it('keeps the accounts it has when a later fetch fails', async () => {
    store.activate();
    await settle();
    http.expectOne('/api/accounts').flush(response('manual'));
    await settle();
    expect(store.accounts()).toEqual(response('manual'));
    store.reload();
    await settle();
    http.expectOne('/api/accounts').error(new ProgressEvent('error'));
    await settle();
    expect(store.failed()).toBe(false);
    expect(store.accounts()).toEqual(response('manual'));
  });

  it('fetches again when the accounts fact fires', async () => {
    store.activate();
    await settle();
    http.expectOne('/api/accounts').flush(response());
    await settle();
    TestBed.inject(Invalidation).fire('accounts');
    await settle();
    http.expectOne('/api/accounts').flush(response('manual'));
    await settle();
    expect(store.accounts()?.syncing).toBe('manual');
  });

  it('forgets the accounts and stops fetching on deactivate', async () => {
    store.activate();
    await settle();
    http.expectOne('/api/accounts').flush(response());
    await settle();
    store.deactivate();
    await settle();
    expect(store.accounts()).toBeUndefined();
    TestBed.inject(Invalidation).fire('accounts');
    await settle();
    http.expectNone('/api/accounts');
  });
});
