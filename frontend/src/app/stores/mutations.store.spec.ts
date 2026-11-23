import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Observable } from 'rxjs';
import { comesBackToKeptList, leaveList } from './transactions.store.testing';
import { AccountsStore } from './accounts.store';
import { BanksStore } from './banks.store';
import { type Fact, Invalidation } from './invalidation';
import { MortgageStore } from './mortgage.store';
import { SavingsStore } from './savings.store';
import { SettlementStore } from './settlement.store';
import { SharesStore } from './shares.store';
import { TransactionsStore } from './transactions.store';

const any = {} as never;

interface Case {
  name: string;
  method: string;
  url: string;
  fact: Fact;
  call: () => Observable<unknown>;
  response?: unknown;
}

const cases: Case[] = [
  // accounts
  ...(['savings', 'hidden', 'share'] as const).map((what): Case => ({
    name: `AccountsStore.${what}`,
    method: 'PUT',
    url: `/api/accounts/4/${what}`,
    fact: 'accounts',
    call: () => {
      const store = TestBed.inject(AccountsStore);
      return what === 'savings'
        ? store.setSavings(4, true)
        : what === 'hidden'
          ? store.setHidden(4, true)
          : store.setShare(4, 'half');
    },
  })),
  // banks
  {
    name: 'BanksStore.remove',
    method: 'DELETE',
    url: '/api/connections/Nordea?continueManually=1,2',
    fact: 'banks',
    call: () => TestBed.inject(BanksStore).remove('Nordea', [1, 2]),
  },
  {
    name: 'BanksStore.deleteForGood',
    method: 'DELETE',
    url: '/api/connections/Nordea/permanent',
    fact: 'banks',
    call: () => TestBed.inject(BanksStore).deleteForGood('Nordea'),
  },
  // shares
  {
    name: 'SharesStore.setSubcategoryShare',
    method: 'PUT',
    url: '/api/subcategories/3/share',
    fact: 'shares',
    call: () => TestBed.inject(SharesStore).setSubcategoryShare(3, 'half'),
  },
  {
    name: 'SharesStore.setHouseholdRatio',
    method: 'PUT',
    url: '/api/household-ratio',
    fact: 'shares',
    call: () => TestBed.inject(SharesStore).setHouseholdRatio([]),
    response: { entries: [] },
  },
  // settlement
  ...(
    [
      ['setBalance', 'POST', '/api/settlement/balance-settings', (s) => s.setBalance(any)],
      ['close', 'POST', '/api/settlement/close', (s) => s.close(any)],
      ['undoClose', 'POST', '/api/settlement/undo-close', (s) => s.undoClose()],
      [
        'saveReport',
        'POST',
        '/api/settlement/periods/2026-10/report',
        (s) => s.saveReport('2026-10'),
      ],
      ['setOpenMonth', 'PUT', '/api/settlement/month', (s) => s.setOpenMonth(any)],
    ] as [string, string, string, (s: SettlementStore) => Observable<unknown>][]
  ).map(([name, method, url, call]): Case => ({
    name: `SettlementStore.${name}`,
    method,
    url,
    fact: 'settlement',
    call: () => call(TestBed.inject(SettlementStore)),
    response: {},
  })),
  // mortgage
  ...(
    [
      ['addPart', 'POST', '/api/mortgage/parts', (s) => s.addPart(any)],
      ['updatePart', 'PUT', '/api/mortgage/parts/2', (s) => s.updatePart(2, any)],
      ['endPart', 'POST', '/api/mortgage/parts/2/end', (s) => s.endPart(2, any)],
      [
        'addRateChange',
        'POST',
        '/api/mortgage/parts/2/rate-changes',
        (s) => s.addRateChange(2, any),
      ],
      [
        'addAmortisationChange',
        'POST',
        '/api/mortgage/parts/2/amortisation-changes',
        (s) => s.addAmortisationChange(2, any),
      ],
      ['addEntry', 'POST', '/api/mortgage/entries', (s) => s.addEntry(any)],
      ['updateEntry', 'PUT', '/api/mortgage/entries/5', (s) => s.updateEntry(5, any)],
      ['deleteEntry', 'DELETE', '/api/mortgage/entries/5', (s) => s.deleteEntry(5)],
    ] as [string, string, string, (s: MortgageStore) => Observable<unknown>][]
  ).map(([name, method, url, call]): Case => ({
    name: `MortgageStore.${name}`,
    method,
    url,
    fact: 'mortgage',
    call: () => call(TestBed.inject(MortgageStore)),
    response: {},
  })),
  // manual savings
  ...(
    [
      ['create', 'POST', '/api/manual-savings-accounts', (s) => s.create(any)],
      ['rename', 'PUT', '/api/manual-savings-accounts/2', (s) => s.rename(2, any)],
      ['close', 'POST', '/api/manual-savings-accounts/2/close', (s) => s.close(2, any)],
      ['reopen', 'POST', '/api/manual-savings-accounts/2/reopen', (s) => s.reopen(2)],
      ['addEntry', 'POST', '/api/manual-savings-accounts/2/entries', (s) => s.addEntry(2, any)],
      [
        'updateEntry',
        'PUT',
        '/api/manual-savings-accounts/2/entries/7',
        (s) => s.updateEntry(2, 7, any),
      ],
      [
        'deleteEntry',
        'DELETE',
        '/api/manual-savings-accounts/2/entries/7',
        (s) => s.deleteEntry(2, 7),
      ],
    ] as [string, string, string, (s: SavingsStore) => Observable<unknown>][]
  ).map(([name, method, url, call]): Case => ({
    name: `SavingsStore.${name}`,
    method,
    url,
    fact: 'savings',
    call: () => call(TestBed.inject(SavingsStore)),
    response: {},
  })),
  // transactions (their refresh effects are checked in transactions.store.spec.ts)
  ...(
    [
      ['addManual', 'POST', '/api/transactions', (s) => s.addManual(any)],
      ['editManual', 'PUT', '/api/transactions/1', (s) => s.editManual(1, any)],
      ['deleteManual', 'DELETE', '/api/transactions/1', (s) => s.deleteManual(1)],
      ['replace', 'POST', '/api/transactions/replace', (s) => s.replace(any)],
      ['notSame', 'POST', '/api/transactions/not-same', (s) => s.notSame(any)],
      ['setOffset', 'PUT', '/api/transactions/1/offset', (s) => s.setOffset(1, 2)],
      ['setShare', 'PUT', '/api/transactions/1/share', (s) => s.setShare(1, null)],
    ] as [string, string, string, (s: TransactionsStore) => Observable<unknown>][]
  ).map(([name, method, url, call]): Case => ({
    name: `TransactionsStore.${name}`,
    method,
    url,
    fact: 'transactions',
    call: () => call(TestBed.inject(TransactionsStore)),
    response: {},
  })),
  {
    name: 'TransactionsStore.setCategory',
    method: 'PUT',
    url: '/api/transactions/1/category',
    fact: 'transactions',
    call: () => TestBed.inject(TransactionsStore).setCategory(1, 2),
    response: { category: null, updatedSimilar: 0, others: [] },
  },
];

describe('store mutations', () => {
  let http: HttpTestingController;
  let fired: Fact[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fired = [];
    const invalidation = TestBed.inject(Invalidation);
    const fire = invalidation.fire.bind(invalidation);
    invalidation.fire = (fact) => {
      fired.push(fact);
      fire(fact);
    };
  });

  it.each(cases)('$name calls $method $url and fires $fact', (c) => {
    c.call().subscribe();
    http.expectOne({ method: c.method, url: c.url }).flush(c.response ?? null);
    expect(fired).toEqual([c.fact]);
    http.match(() => true);
  });

  it.each(cases)('$name fires nothing when the request fails', (c) => {
    c.call().subscribe({ error: () => undefined });
    http.expectOne({ method: c.method, url: c.url }).flush('x', { status: 500, statusText: 'x' });
    expect(fired).toEqual([]);
  });

  it('BanksStore.startConnection posts the bank and emits the URL, firing nothing', () => {
    let url = '';
    TestBed.inject(BanksStore)
      .startConnection('Nordea', true)
      .subscribe((u) => (url = u));
    const request = http.expectOne('/api/connections');
    expect(request.request.body).toEqual({ bank: 'Nordea', renew: true });
    request.flush({ url: 'https://bank.example/login' });
    expect(url).toBe('https://bank.example/login');
    expect(fired).toEqual([]);
  });

  it('BanksStore.startSync posts to /api/sync', () => {
    TestBed.inject(BanksStore).startSync().subscribe();
    http.expectOne({ method: 'POST', url: '/api/sync' }).flush({});
  });

  it('BanksStore.connectionResult fires banks', () => {
    TestBed.inject(BanksStore).connectionResult();
    expect(fired).toEqual(['banks']);
  });
});

describe('what the owner would see after a mutation (#201)', () => {
  let http: HttpTestingController;
  let transactions: TransactionsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    transactions = TestBed.inject(TransactionsStore);
  });

  const mutations: [string, string, string, () => Observable<unknown>, unknown][] = [
    [
      'hiding an account',
      'PUT',
      '/api/accounts/1/hidden',
      () => TestBed.inject(AccountsStore).setHidden(1, true),
      null,
    ],
    [
      'marking a savings account',
      'PUT',
      '/api/accounts/1/savings',
      () => TestBed.inject(AccountsStore).setSavings(1, true),
      null,
    ],
    [
      'changing an account share',
      'PUT',
      '/api/accounts/1/share',
      () => TestBed.inject(AccountsStore).setShare(1, 'half'),
      null,
    ],
    [
      'changing a subcategory share',
      'PUT',
      '/api/subcategories/1/share',
      () => TestBed.inject(SharesStore).setSubcategoryShare(1, 'half'),
      null,
    ],
    [
      'changing the household ratio',
      'PUT',
      '/api/household-ratio',
      () => TestBed.inject(SharesStore).setHouseholdRatio([]),
      { entries: [] },
    ],
    [
      'removing a bank',
      'DELETE',
      '/api/connections/Nordea',
      () => TestBed.inject(BanksStore).remove('Nordea'),
      null,
    ],
    [
      'deleting a bank for good',
      'DELETE',
      '/api/connections/Nordea/permanent',
      () => TestBed.inject(BanksStore).deleteForGood('Nordea'),
      null,
    ],
  ];

  const SHARES_ONLY = new Set(['changing a subcategory share', 'changing the household ratio']);

  it.each(mutations)(
    '%s drops the kept list (and fetches the review count again where ADR 0015 says)',
    (name, method, url, call, response) => {
      leaveList(http);
      call().subscribe();
      http
        .expectOne((request) => request.method === method && request.url === url)
        .flush(response as never);
      // ADR 0015: the `shares` fact moves shares, not what waits for review.
      if (SHARES_ONLY.has(name)) {
        http.expectNone('/api/transactions/review/count');
      } else {
        http.expectOne('/api/transactions/review/count').flush({ count: 4 });
        expect(transactions.reviewCount()).toBe(4);
      }
      expect(comesBackToKeptList(http)).toBe(false);
    },
  );

  it('a settlement change leaves the kept list and the review count alone', () => {
    leaveList(http);
    TestBed.inject(SettlementStore).undoClose().subscribe();
    http.expectOne('/api/settlement/undo-close').flush({});
    http.expectNone('/api/transactions/review/count');
    expect(comesBackToKeptList(http)).toBe(true);
  });
});
