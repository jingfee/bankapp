import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';
import { TransactionsService } from './transactions.service';

const manual = {
  description: 'x',
  amount: 1,
  date: '2026-11-01',
  subcategoryId: 1,
  paidBy: 'owner',
  share: 'me',
} as never;

describe('TransactionsService mutations', () => {
  let service: TransactionsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TransactionsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const mutations: [
    string,
    string,
    string,
    (s: TransactionsService) => Observable<unknown>,
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
      service.listed = { key: '', transactions: [], cursor: null, count: 0, sum: null };
      call(service).subscribe();
      http.expectOne({ method, url }).flush(response);
      http.expectOne('/api/transactions/review/count').flush({ count: 3 });
      expect(service.reviewCount()).toBe(3);
      if (name !== 'setCategory') expect(service.listed).toBeNull();
    });
  }

  it('keeps the listed transactions after a category change, updating the rows it touched', () => {
    const row = (id: number) => ({ id, category: null }) as never;
    const category = (name: string) => ({ subcategory: { name } }) as never;
    const listed = {
      key: 'q',
      transactions: [row(1), row(2), row(3), row(4)],
      cursor: 'c',
      count: 9,
      sum: null,
    };
    service.listed = listed;

    service.setCategory(1, 2).subscribe();
    http.expectOne('/api/transactions/1/category').flush({
      category: category('Mat'),
      updatedSimilar: 1,
      others: [
        { id: 2, category: category('Mat') },
        { id: 4, category: null },
      ],
    });
    http.expectOne('/api/transactions/review/count').flush({ count: 0 });

    expect(service.listed?.key).toBe('q');
    expect(service.listed?.cursor).toBe('c');
    expect(service.listed?.count).toBe(9);
    expect(service.listed?.transactions.map((t) => t.category)).toEqual([
      category('Mat'),
      category('Mat'),
      null,
      null,
    ]);
  });
});
