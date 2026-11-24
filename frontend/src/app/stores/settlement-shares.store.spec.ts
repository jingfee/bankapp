import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SettlementResponse } from '@bankapp/shared';
import { Invalidation } from './invalidation';
import { SettlementStore } from './settlement.store';
import { SharesStore } from './shares.store';

const settlement = (balance: number): SettlementResponse => ({
  balance,
  periods: [],
  balanceSettings: [],
});

describe('SettlementStore and SharesStore reads', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // whenStable would wait for the open request, so let the effects and promises run instead.
  const settle = async () => {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  it('fetches the settlement once activated, and again when the settlement fact fires', async () => {
    const store = TestBed.inject(SettlementStore);
    await settle();
    http.expectNone('/api/settlement');

    store.activate();
    await settle();
    expect(store.loading()).toBe(true);
    http.expectOne('/api/settlement').flush(settlement(100));
    await settle();
    expect(store.settlement()).toEqual(settlement(100));
    expect(store.loading()).toBe(false);

    TestBed.inject(Invalidation).fire('settlement');
    await settle();
    http.expectOne('/api/settlement').flush(settlement(250));
    await settle();
    expect(store.settlement()?.balance).toBe(250);
  });

  it('is failed when the settlement cannot be fetched, and keeps the old one when a refresh fails', async () => {
    const store = TestBed.inject(SettlementStore);
    store.activate();
    await settle();
    http.expectOne('/api/settlement').error(new ProgressEvent('error'));
    await settle();
    expect(store.failed()).toBe(true);

    TestBed.inject(Invalidation).fire('settlement');
    await settle();
    http.expectOne('/api/settlement').flush(settlement(1));
    await settle();
    expect(store.failed()).toBe(false);
    expect(store.settlement()?.balance).toBe(1);

    TestBed.inject(Invalidation).fire('settlement');
    await settle();
    http.expectOne('/api/settlement').error(new ProgressEvent('error'));
    await settle();
    expect(store.settlement()?.balance).toBe(1);
    expect(store.failed()).toBe(false);
  });

  it('forgets the settlement when deactivated', async () => {
    const store = TestBed.inject(SettlementStore);
    store.activate();
    await settle();
    http.expectOne('/api/settlement').flush(settlement(1));
    await settle();

    store.deactivate();
    await settle();
    expect(store.settlement()).toBeUndefined();
  });

  it('fetches the ratio and the shares once activated, and again on the shares fact', async () => {
    const store = TestBed.inject(SharesStore);
    store.activate();
    await settle();
    http
      .expectOne('/api/household-ratio')
      .flush({ entries: [{ from: '2026-01-01', percent: 60 }], inForceFrom: '2026-01-01' });
    http
      .expectOne('/api/subcategory-shares')
      .flush({ shares: [{ subcategoryId: 1, share: 'half' }] });
    await settle();
    expect(store.householdRatio()).toEqual([{ from: '2026-01-01', percent: 60 }]);
    expect(store.householdRatioInForceFrom()).toBe('2026-01-01');
    expect(store.subcategoryShares()).toEqual([{ subcategoryId: 1, share: 'half' }]);

    TestBed.inject(Invalidation).fire('shares');
    await settle();
    http.expectOne('/api/household-ratio').flush({ entries: [], inForceFrom: null });
    http.expectOne('/api/subcategory-shares').flush({ shares: [] });
    await settle();
    expect(store.householdRatio()).toEqual([]);
  });

  it('is failed when either shares read cannot be fetched', async () => {
    const store = TestBed.inject(SharesStore);
    store.activate();
    await settle();
    http.expectOne('/api/household-ratio').flush({ entries: [] });
    http.expectOne('/api/subcategory-shares').error(new ProgressEvent('error'));
    await settle();
    expect(store.failed()).toBe(true);
    expect(store.householdRatio()).toEqual([]);
  });
});
