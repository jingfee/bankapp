import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { MortgageFiguresResponse, MortgageResponse } from '@bankapp/shared';
import { type Fact, Invalidation } from './invalidation';
import { MortgageStore } from './mortgage.store';

const MORTGAGE: MortgageResponse = { parts: [], entries: [] };
const FIGURES: MortgageFiguresResponse = {
  debts: [],
  totalDebt: 0,
  averageRate: null,
  months: [],
  monthsWithoutPayment: [],
  paymentsSubcategoryId: null,
};

describe('MortgageStore reads', () => {
  let http: HttpTestingController;
  let store: MortgageStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MortgageStore);
  });

  afterEach(() => http.verify());

  // whenStable would wait for the open request, so let the effects and promises run instead.
  const settle = async () => {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  it('reads the mortgage and the figures', async () => {
    const mortgage = TestBed.runInInjectionContext(() => store.mortgage());
    const figures = TestBed.runInInjectionContext(() => store.figures());
    await settle();
    expect(mortgage.loading()).toBe(true);
    http.expectOne('/api/mortgage').flush(MORTGAGE);
    http.expectOne('/api/mortgage/figures').flush(FIGURES);
    await settle();
    expect(mortgage.value()).toEqual(MORTGAGE);
    expect(figures.value()).toEqual(FIGURES);
  });

  it('says it failed when the mortgage cannot be fetched', async () => {
    const mortgage = TestBed.runInInjectionContext(() => store.mortgage());
    await settle();
    http.expectOne('/api/mortgage').error(new ProgressEvent('error'));
    await settle();
    expect(mortgage.failed()).toBe(true);
  });

  it.each<[Fact, boolean, boolean]>([
    ['mortgage', true, true],
    ['transactions', false, true],
    ['accounts', false, true],
    ['banks', true, true],
    ['shares', false, false],
    ['savings', false, false],
  ])('after %s: mortgage fetched again %s, figures %s', async (fact, mortgage, figures) => {
    TestBed.runInInjectionContext(() => {
      store.mortgage();
      store.figures();
    });
    await settle();
    http.expectOne('/api/mortgage').flush(MORTGAGE);
    http.expectOne('/api/mortgage/figures').flush(FIGURES);
    await settle();

    TestBed.inject(Invalidation).fire(fact);
    await settle();
    if (mortgage) http.expectOne('/api/mortgage').flush(MORTGAGE);
    else http.expectNone('/api/mortgage');
    if (figures) http.expectOne('/api/mortgage/figures').flush(FIGURES);
    else http.expectNone('/api/mortgage/figures');
  });
});
