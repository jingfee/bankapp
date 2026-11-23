import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';
import { EMPTY_FILTERS } from '../pages/transactions/transaction-filters';
import { Invalidation } from './invalidation';
import { TransactionsStore } from './transactions.store';
import { comesBackToKeptList, leaveList, openList, page, row } from './transactions.store.testing';

const manual = {
  description: 'x',
  amount: 1,
  date: '2026-11-01',
  subcategoryId: 1,
  paidBy: 'owner',
  share: 'me',
} as never;

describe('TransactionsStore mutations', () => {
  let store: TransactionsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(TransactionsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const mutations: [
    string,
    string,
    string,
    (s: TransactionsStore) => Observable<unknown>,
    object | null,
  ][] = [
    ['addManual', 'POST', '/api/transactions', (s) => s.addManual(manual), {}],
    ['editManual', 'PUT', '/api/transactions/1', (s) => s.editManual(1, manual), {}],
    ['deleteManual', 'DELETE', '/api/transactions/1', (s) => s.deleteManual(1), null],
    ['replace', 'POST', '/api/transactions/replace', (s) => s.replace({} as never), null],
    ['notSame', 'POST', '/api/transactions/not-same', (s) => s.notSame({} as never), null],
    [
      'setCategory',
      'PUT',
      '/api/transactions/1/category',
      (s) => s.setCategory(1, 2),
      { category: null, updatedSimilar: 0, others: [] },
    ],
    ['setOffset', 'PUT', '/api/transactions/1/offset', (s) => s.setOffset(1, 2), {}],
    ['setShare', 'PUT', '/api/transactions/1/share', (s) => s.setShare(1, 'half'), {}],
  ];

  for (const [name, method, url, call, response] of mutations) {
    it(`${name} refreshes the review count and drops the kept list`, () => {
      leaveList(http);
      call(store).subscribe();
      http.expectOne({ method, url }).flush(response);
      http.expectOne('/api/transactions/review/count').flush({ count: 3 });
      expect(store.reviewCount()).toBe(3);
      if (name !== 'setCategory') expect(comesBackToKeptList(http)).toBe(false);
    });
  }

  it('keeps the listed transactions after a category change, updating the rows it touched', () => {
    const category = (name: string) => ({ subcategory: { name } }) as never;
    leaveList(http, [row(1), row(2), row(3), row(4)], { ...EMPTY_FILTERS, q: 'q' }, 'c');

    store.setCategory(1, 2).subscribe();
    http.expectOne('/api/transactions/1/category').flush({
      category: category('Mat'),
      updatedSimilar: 1,
      others: [
        { id: 2, category: category('Mat') },
        { id: 4, category: null },
      ],
    });
    http.expectOne('/api/transactions/review/count').flush({ count: 0 });

    const { read, close } = openList({ filters: { ...EMPTY_FILTERS, q: 'q' }, restore: true });
    http.expectNone((r) => r.url === '/api/transactions');
    expect(read.transactions().map((t) => t.category)).toEqual([
      category('Mat'),
      category('Mat'),
      null,
      null,
    ]);
    expect(read.hasMore()).toBe(true);
    expect(read.count()).toBe(4);
    close();
  });
});

describe('TransactionsStore reads', () => {
  let store: TransactionsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(TransactionsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match('/api/transactions/review/count').forEach((r) => r.flush({ count: 0 }));
    http.verify();
  });

  const list = (r: { url: string }) => r.url === '/api/transactions';

  // whenStable would wait for an open request, so let the effects and promises run instead.
  const settle = async () => {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  describe('the list', () => {
    it('fetches nothing until it is asked for a list', () => {
      const { read, close } = openList(undefined);
      http.expectNone(list);
      expect(read.status()).toBe('loading');
      close();
    });

    it('fetches the first page for the filters, and shows it', () => {
      const filters = {
        ...EMPTY_FILTERS,
        q: 'ica',
        accounts: ['3', 'manual'],
        kind: 'out' as const,
      };
      const { read, close } = openList({ filters, restore: false });
      expect(read.status()).toBe('loading');

      const request = http.expectOne(list);
      expect(request.request.params.has('before')).toBe(false);
      expect(request.request.params.get('q')).toBe('ica');
      expect(request.request.params.get('accounts')).toBe('3,manual');
      expect(request.request.params.get('kind')).toBe('out');
      request.flush({
        ...page([row(2), row(1)], 'c'),
        count: 9,
        sum: { amount: -5, currency: 'SEK' },
      });

      expect(read.status()).toBe('ready');
      expect(read.transactions().map((t) => t.id)).toEqual([2, 1]);
      expect(read.count()).toBe(9);
      expect(read.sum()).toEqual({ amount: -5, currency: 'SEK' });
      expect(read.hasMore()).toBe(true);
      close();
    });

    it('says it failed when the first page cannot be fetched', () => {
      const { read, close } = openList({ filters: EMPTY_FILTERS, restore: false });
      http.expectOne(list).error(new ProgressEvent('error'));

      expect(read.status()).toBe('failed');
      close();
    });

    it('fetches the next page with the same filters and adds it', () => {
      const { read, close } = openList({
        filters: { ...EMPTY_FILTERS, q: 'ica' },
        restore: false,
      });
      http.expectOne(list).flush(page([row(2)], 'c2'));

      read.loadMore();
      expect(read.loadingMore()).toBe(true);
      read.loadMore();
      const next = http.expectOne((r) => list(r) && r.params.get('before') === 'c2');
      expect(next.request.params.get('q')).toBe('ica');
      next.flush(page([row(1)]));

      expect(read.loadingMore()).toBe(false);
      expect(read.transactions().map((t) => t.id)).toEqual([2, 1]);
      expect(read.hasMore()).toBe(false);
      close();
    });

    it('keeps what is shown and says so when the next page fails', () => {
      const { read, close } = openList({ filters: EMPTY_FILTERS, restore: false });
      http.expectOne(list).flush(page([row(1)], 'c1'));

      read.loadMore();
      http.expectOne((r) => r.params.get('before') === 'c1').error(new ProgressEvent('error'));

      expect(read.moreFailed()).toBe(true);
      expect(read.loadingMore()).toBe(false);
      expect(read.transactions()).toHaveLength(1);
      expect(read.hasMore()).toBe(true);
      close();
    });

    it('follows the request: new filters fetch again and drop a next page still on its way', () => {
      const { read, request, close } = openList({ filters: EMPTY_FILTERS, restore: false });
      http.expectOne(list).flush(page([row(1)], 'c1'));
      read.loadMore();
      const stale = http.expectOne((r) => r.params.get('before') === 'c1');

      request.set({ filters: { ...EMPTY_FILTERS, q: 'x' }, restore: false });
      TestBed.tick();

      expect(stale.cancelled).toBe(true);
      expect(read.loadingMore()).toBe(false);
      // The old rows stay until the new ones arrive.
      expect(read.status()).toBe('ready');
      http.expectOne((r) => list(r) && r.params.get('q') === 'x').flush(page([row(7)]));
      expect(read.transactions().map((t) => t.id)).toEqual([7]);
      close();
    });

    it('is fetched again from the first page when a fact moves transactions or shares', () => {
      const { read, close } = openList({ filters: EMPTY_FILTERS, restore: false });
      http.expectOne(list).flush(page([row(1)]));

      TestBed.inject(Invalidation).fire('transactions');
      TestBed.tick();
      http.expectOne(list).flush(page([row(1), row(2)]));
      expect(read.transactions()).toHaveLength(2);

      TestBed.inject(Invalidation).fire('shares');
      TestBed.tick();
      http.expectOne(list).flush(page([row(3)]));
      expect(read.transactions().map((t) => t.id)).toEqual([3]);
      close();
    });

    it('keeps the rows already shown when a refresh fails', () => {
      const { read, close } = openList({ filters: EMPTY_FILTERS, restore: false });
      http.expectOne(list).flush(page([row(1)]));

      TestBed.inject(Invalidation).fire('transactions');
      TestBed.tick();
      http.expectOne(list).error(new ProgressEvent('error'));

      expect(read.status()).toBe('ready');
      expect(read.transactions()).toHaveLength(1);
      close();
    });

    it('is not fetched again for a fact that does not touch it', () => {
      const { close } = openList({ filters: EMPTY_FILTERS, restore: false });
      http.expectOne(list).flush(page([row(1)]));

      TestBed.inject(Invalidation).fire('settlement');
      TestBed.inject(Invalidation).fire('mortgage');
      TestBed.tick();

      http.expectNone(list);
      close();
    });

    it('stops with the page that asked', () => {
      const { close } = openList({ filters: EMPTY_FILTERS, restore: false });
      const pending = http.expectOne(list);
      close();

      expect(pending.cancelled).toBe(true);
      TestBed.inject(Invalidation).fire('transactions');
      TestBed.tick();
      http.expectNone(list);
    });

    describe('coming back with the back button', () => {
      it('shows the list as it was left, with its pages and without fetching', () => {
        leaveList(http, [row(2), row(1)], EMPTY_FILTERS, 'c1');

        const { read, close } = openList({ filters: EMPTY_FILTERS, restore: true });

        http.expectNone(list);
        expect(read.status()).toBe('ready');
        expect(read.transactions().map((t) => t.id)).toEqual([2, 1]);
        expect(read.hasMore()).toBe(true);
        close();
      });

      it('keeps the pages loaded with Visa fler', () => {
        const first = openList({ filters: EMPTY_FILTERS, restore: false });
        http.expectOne(list).flush(page([row(2)], 'c2'));
        first.read.loadMore();
        http.expectOne((r) => r.params.get('before') === 'c2').flush(page([row(1)]));
        first.close();

        const back = openList({ filters: EMPTY_FILTERS, restore: true });

        expect(back.read.transactions().map((t) => t.id)).toEqual([2, 1]);
        expect(back.read.hasMore()).toBe(false);
        back.close();
      });

      it('loads afresh when it is not a back navigation', () => {
        leaveList(http, [row(9)]);

        const { read, close } = openList({ filters: EMPTY_FILTERS, restore: false });
        http.expectOne(list).flush(page([row(1)]));

        expect(read.transactions().map((t) => t.id)).toEqual([1]);
        close();
      });

      it('loads afresh for other filters than the list was left with', () => {
        leaveList(http, [row(9)], { ...EMPTY_FILTERS, q: 'other' });

        const { read, close } = openList({
          filters: { ...EMPTY_FILTERS, q: 'ica' },
          restore: true,
        });
        http.expectOne(list).flush(page([row(1)]));

        expect(read.transactions().map((t) => t.id)).toEqual([1]);
        close();
      });

      it.each(['transactions', 'accounts', 'shares', 'banks'] as const)(
        'loads afresh once %s changed, which dropped the list',
        (fact) => {
          leaveList(http);
          TestBed.inject(Invalidation).fire(fact);

          expect(comesBackToKeptList(http)).toBe(false);
        },
      );
    });
  });

  describe('the review', () => {
    const body = (count: number) => ({
      transactions: [row(1)],
      replacements: [],
      count,
    });

    it('reads what waits for review, and the count with it', async () => {
      const read = TestBed.runInInjectionContext(() => store.review());
      await settle();
      http.expectOne('/api/transactions/review').flush(body(4));
      await settle();

      expect(read.value()?.transactions.map((t) => t.id)).toEqual([1]);
      expect(store.reviewCount()).toBe(4);
      http.expectNone('/api/transactions/review/count');
    });

    it('is fetched again with the count when a fact moves transactions', async () => {
      const read = TestBed.runInInjectionContext(() => store.review());
      await settle();
      http.expectOne('/api/transactions/review').flush(body(4));
      await settle();

      TestBed.inject(Invalidation).fire('transactions');
      await settle();
      http.expectOne('/api/transactions/review').flush({ ...body(3), transactions: [] });
      await settle();

      expect(read.value()?.transactions).toEqual([]);
      expect(store.reviewCount()).toBe(3);
      // The list's answer is newer than the count request that fired with it.
      http.match('/api/transactions/review/count').forEach((r) => expect(r.cancelled).toBe(true));
    });

    it('keeps what it showed when a refresh fails', async () => {
      const read = TestBed.runInInjectionContext(() => store.review());
      await settle();
      http.expectOne('/api/transactions/review').flush(body(1));
      await settle();

      TestBed.inject(Invalidation).fire('transactions');
      await settle();
      http.expectOne('/api/transactions/review').error(new ProgressEvent('error'));
      await settle();

      expect(read.value()?.transactions).toHaveLength(1);
      expect(read.failed()).toBe(false);
    });

    it('says it failed when it cannot be fetched', async () => {
      const read = TestBed.runInInjectionContext(() => store.review());
      await settle();
      http.expectOne('/api/transactions/review').error(new ProgressEvent('error'));
      await settle();

      expect(read.failed()).toBe(true);
    });
  });

  describe('the review count', () => {
    it('is 0 until it is known, then fetched on request', () => {
      expect(store.reviewCount()).toBe(0);
      store.refreshReviewCount();
      http.expectOne('/api/transactions/review/count').flush({ count: 5 });
      expect(store.reviewCount()).toBe(5);
    });

    it('lets only the latest request set it, and keeps it when one fails', () => {
      store.refreshReviewCount();
      const older = http.expectOne('/api/transactions/review/count');
      store.refreshReviewCount();
      expect(older.cancelled).toBe(true);
      http.expectOne('/api/transactions/review/count').flush({ count: 2 });
      store.refreshReviewCount();
      http.expectOne('/api/transactions/review/count').error(new ProgressEvent('error'));
      expect(store.reviewCount()).toBe(2);
    });

    it('goes back to 0 on reset', () => {
      store.refreshReviewCount();
      http.expectOne('/api/transactions/review/count').flush({ count: 5 });
      store.resetReviewCount();
      expect(store.reviewCount()).toBe(0);
    });
  });

  describe('the details', () => {
    it('fetches nothing without an id', async () => {
      const { value } = TestBed.runInInjectionContext(() => store.details(signal(undefined)));
      await settle();

      http.expectNone('/api/transactions/5');
      expect(value()).toBeUndefined();
    });

    it('reads the transaction of the id, and follows the id', async () => {
      const id = signal<string | undefined>('5');
      const read = TestBed.runInInjectionContext(() => store.details(id));
      await settle();
      expect(read.loading()).toBe(true);
      http.expectOne('/api/transactions/5').flush({ id: 5 });
      await settle();
      expect(read.value()).toEqual({ id: 5 });
      expect(read.loading()).toBe(false);

      id.set('8');
      await settle();
      http.expectOne('/api/transactions/8').flush({ id: 8 });
      await settle();
      expect(read.value()).toEqual({ id: 8 });
    });

    it('has the 404 as its error when the transaction is gone', async () => {
      const read = TestBed.runInInjectionContext(() => store.details(signal('5')));
      await settle();
      http.expectOne('/api/transactions/5').flush('', { status: 404, statusText: 'Not Found' });
      await settle();

      expect(read.failed()).toBe(true);
      expect((read.error() as HttpErrorResponse).status).toBe(404);
    });

    it('is fetched again when a fact moves transactions or shares', async () => {
      const read = TestBed.runInInjectionContext(() => store.details(signal('5')));
      await settle();
      http.expectOne('/api/transactions/5').flush({ id: 5, note: 'a' });
      await settle();

      TestBed.inject(Invalidation).fire('shares');
      await settle();
      http.expectOne('/api/transactions/5').flush({ id: 5, note: 'b' });
      await settle();

      expect(read.value()).toEqual({ id: 5, note: 'b' });
    });
  });

  it('get reads one transaction once, escaping the id', () => {
    store.get('a b').subscribe();
    http.expectOne('/api/transactions/a%20b').flush({});
  });

  it('offsetCandidates asks for the likely purchases, or those matching the search', () => {
    store.offsetCandidates(5).subscribe();
    expect(http.expectOne('/api/transactions/5/offset-candidates').request.params.keys()).toEqual(
      [],
    );
    store.offsetCandidates(5, ' zal ').subscribe();
    http
      .expectOne(
        (r) => r.url === '/api/transactions/5/offset-candidates' && r.params.get('q') === 'zal',
      )
      .flush({});
  });
});
