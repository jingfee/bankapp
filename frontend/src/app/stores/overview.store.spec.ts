import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { OverviewResponse, Transaction } from '@bankapp/shared';
import { type Fact, Invalidation } from './invalidation';
import { type OverviewParams, OverviewStore } from './overview.store';

const overview = (spending: number): OverviewResponse => ({
  month: '2026-11',
  totals: { income: 0, spending, net: -spending },
  previous: { income: 0, spending: 0, net: 0 },
  spendingByDay: { current: [], previous: [] },
  savings: { subcategoryId: null, current: 0, previous: 0 },
  categories: [],
  uncategorised: 0,
});

describe('OverviewStore reads', () => {
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

  const overviewRequest = (month: string, view: string) =>
    http.expectOne(
      (r) =>
        r.url === '/api/overview' &&
        r.params.get('month') === month &&
        r.params.get('view') === view,
    );

  it('fetches the month and view it is given, and again when either changes', async () => {
    const params = signal<OverviewParams>({ month: '2026-11', view: 'mine' });
    const read = TestBed.runInInjectionContext(() =>
      TestBed.inject(OverviewStore).overview(params),
    );
    await settle();
    expect(read.loading()).toBe(true);
    overviewRequest('2026-11', 'mine').flush(overview(100));
    await settle();
    expect(read.value()?.totals.spending).toBe(100);
    expect(read.loading()).toBe(false);

    params.set({ month: '2026-10', view: 'mine' });
    await settle();
    expect(read.value()).toBeUndefined();
    expect(read.loading()).toBe(true);
    overviewRequest('2026-10', 'mine').flush(overview(30));
    await settle();
    expect(read.value()?.totals.spending).toBe(30);

    params.set({ month: '2026-10', view: 'full' });
    await settle();
    overviewRequest('2026-10', 'full').flush(overview(60));
    await settle();
    expect(read.value()?.totals.spending).toBe(60);
  });

  it.each<Fact>(['transactions', 'shares', 'banks', 'accounts', 'settlement'])(
    'fetches the overview again, keeping the old one meanwhile, when %s fires',
    async (fact) => {
      const params = signal<OverviewParams>({ month: '2026-11', view: 'mine' });
      const read = TestBed.runInInjectionContext(() =>
        TestBed.inject(OverviewStore).overview(params),
      );
      await settle();
      overviewRequest('2026-11', 'mine').flush(overview(100));
      await settle();

      TestBed.inject(Invalidation).fire(fact);
      await settle();
      expect(read.value()?.totals.spending).toBe(100);
      expect(read.loading()).toBe(false);
      overviewRequest('2026-11', 'mine').flush(overview(250));
      await settle();
      expect(read.value()?.totals.spending).toBe(250);
    },
  );

  it('does not fetch again for a fact the overview does not depend on', async () => {
    const params = signal<OverviewParams>({ month: '2026-11', view: 'mine' });
    const read = TestBed.runInInjectionContext(() =>
      TestBed.inject(OverviewStore).overview(params),
    );
    await settle();
    overviewRequest('2026-11', 'mine').flush(overview(100));
    await settle();

    TestBed.inject(Invalidation).fire('mortgage');
    await settle();

    http.expectNone('/api/overview');
    expect(read.value()?.totals.spending).toBe(100);
  });

  it('keeps the old overview when a refresh fails, and is failed when the first fetch fails', async () => {
    const params = signal<OverviewParams>({ month: '2026-11', view: 'mine' });
    const read = TestBed.runInInjectionContext(() =>
      TestBed.inject(OverviewStore).overview(params),
    );
    await settle();
    overviewRequest('2026-11', 'mine').flush(overview(100));
    await settle();
    expect(read.value()?.totals.spending).toBe(100);

    TestBed.inject(Invalidation).fire('transactions');
    await settle();
    overviewRequest('2026-11', 'mine').error(new ProgressEvent('error'));
    await settle();
    expect(read.value()?.totals.spending).toBe(100);
    expect(read.failed()).toBe(false);

    params.set({ month: '2026-10', view: 'mine' });
    await settle();
    overviewRequest('2026-10', 'mine').error(new ProgressEvent('error'));
    await settle();
    expect(read.value()).toBeUndefined();
    expect(read.failed()).toBe(true);
  });

  it('fetches a drill-down only while a subcategory is given', async () => {
    const params = signal<{ month: string; subcategoryId: number } | undefined>(undefined);
    const read = TestBed.runInInjectionContext(() =>
      TestBed.inject(OverviewStore).subcategoryTransactions(params),
    );
    await settle();
    http.expectNone('/api/overview/transactions');
    expect(read.loading()).toBe(false);

    params.set({ month: '2026-11', subcategoryId: 12 });
    await settle();
    const request = http.expectOne((r) => r.url === '/api/overview/transactions');
    expect(request.request.urlWithParams).toBe('/api/overview/transactions?month=2026-11');
    request.flush({ transactions: [] });
    await settle();
    expect(read.value()).toEqual({ transactions: [] });

    TestBed.inject(Invalidation).fire('shares');
    await settle();
    http.expectOne((r) => r.url === '/api/overview/transactions').flush({ transactions: [] });
  });

  it("reads the whole month once and picks each subcategory's transactions out of it", async () => {
    const inSubcategory = (id: string, subcategoryId: number) =>
      ({ id, category: { subcategory: { id: subcategoryId } } }) as unknown as Transaction;
    const params = signal({ month: '2026-11', subcategoryId: 12 });
    const read = TestBed.runInInjectionContext(() =>
      TestBed.inject(OverviewStore).subcategoryTransactions(params),
    );
    await settle();
    http.expectOne('/api/overview/transactions?month=2026-11').flush({
      transactions: [inSubcategory('a', 12), inSubcategory('b', 13), inSubcategory('c', 12)],
    });
    await settle();
    expect(read.value()?.transactions.map((t) => t.id)).toEqual(['a', 'c']);

    params.set({ month: '2026-11', subcategoryId: 13 });
    await settle();

    http.expectNone((r) => r.url === '/api/overview/transactions');
    expect(read.value()?.transactions.map((t) => t.id)).toEqual(['b']);
  });
});
