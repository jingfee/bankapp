import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ManualSavingsResponse, SavingsResponse } from '@bankapp/shared';
import { type Fact, Invalidation } from './invalidation';
import { SavingsStore } from './savings.store';

const SAVINGS: SavingsResponse = {
  accounts: [],
  months: [],
  totals: { balance: 0, netDeposits: null, growth: null, growthPercent: null, approximate: false },
  reminders: [],
};
const MANUAL: ManualSavingsResponse = { accounts: [] };

describe('SavingsStore reads', () => {
  let http: HttpTestingController;
  let store: SavingsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(SavingsStore);
  });

  afterEach(() => http.verify());

  // whenStable would wait for the open request, so let the effects and promises run instead.
  const settle = async () => {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  it('reads the savings and the manual savings accounts', async () => {
    const savings = TestBed.runInInjectionContext(() => store.savings());
    const manual = TestBed.runInInjectionContext(() => store.manualSavings());
    await settle();
    expect(savings.loading()).toBe(true);
    http.expectOne('/api/savings').flush(SAVINGS);
    http.expectOne('/api/manual-savings-accounts').flush(MANUAL);
    await settle();
    expect(savings.value()).toEqual(SAVINGS);
    expect(manual.value()).toEqual(MANUAL);
  });

  it('says it failed when the savings cannot be fetched', async () => {
    const savings = TestBed.runInInjectionContext(() => store.savings());
    await settle();
    http.expectOne('/api/savings').error(new ProgressEvent('error'));
    await settle();
    expect(savings.failed()).toBe(true);
  });

  it.each<[Fact, boolean, boolean]>([
    ['savings', true, true],
    ['accounts', true, false],
    ['banks', true, true],
    ['transactions', false, false],
    ['mortgage', false, false],
  ])('after %s: savings fetched again %s, manual savings %s', async (fact, savings, manual) => {
    TestBed.runInInjectionContext(() => {
      store.savings();
      store.manualSavings();
    });
    await settle();
    http.expectOne('/api/savings').flush(SAVINGS);
    http.expectOne('/api/manual-savings-accounts').flush(MANUAL);
    await settle();

    TestBed.inject(Invalidation).fire(fact);
    await settle();
    if (savings) http.expectOne('/api/savings').flush(SAVINGS);
    else http.expectNone('/api/savings');
    if (manual) http.expectOne('/api/manual-savings-accounts').flush(MANUAL);
    else http.expectNone('/api/manual-savings-accounts');
  });
});
