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
      { category: null, updatedSimilar: 0 },
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
});
