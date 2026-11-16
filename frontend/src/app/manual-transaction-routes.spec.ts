import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CategoriesResponse, TransactionDetails } from '@bankapp/shared';
import { detailsMatcher, listMatcher } from './app.routes';
import { ToastService } from './toast/toast.service';
import { TransactionDetailsPage } from './pages/transaction-details/transaction-details.page';
import { TransactionsPage } from './pages/transactions/transactions.page';

const categories = {
  categories: [
    {
      id: 1,
      name: 'Mat',
      kind: 'expense',
      colour: 'green',
      icon: 'shopping-basket',
      fixed: false,
      subcategories: [{ id: 11, name: 'Livsmedel', icon: 'shopping-basket' }],
    },
  ],
} as unknown as CategoriesResponse;

const manual = {
  id: 5,
  status: 'booked',
  description: 'ICA Maxi',
  amount: { amount: -300, currency: 'SEK' },
  account: null,
  transactionDate: '2026-11-10',
  category: {
    subcategory: { id: 11, name: 'Livsmedel', icon: 'shopping-basket' },
    category: { id: 1, name: 'Mat', colour: 'green' },
    confirmed: true,
  },
  share: { option: 'me', percent: 100, source: 'default' },
  paidBy: 'owner',
  remittanceInformation: [],
  exchangeRate: null,
  offsets: null,
  refunds: [],
  netAmount: null,
  raw: '{}',
} as unknown as TransactionDetails;

describe('the manual transaction form over its page', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { matcher: listMatcher, component: TransactionsPage },
          { matcher: detailsMatcher, component: TransactionDetailsPage },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    http
      .match('/api/transactions/review/count')
      .forEach((r) => (r.cancelled ? undefined : r.flush({ count: 0 })));
    http.verify();
  });

  const page = () => harness.routeNativeElement as HTMLElement;
  const settle = async () => {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  };
  const emptyList = () =>
    http
      .expectOne((r) => r.url === '/api/transactions')
      .flush({ transactions: [], nextCursor: null, count: 0, sum: null });

  function fill(selector: string, value: string) {
    const el = document.querySelector(selector) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  /** Answers whatever the details page and the form have asked for so far. */
  function answer() {
    http.match('/api/transactions/5').forEach((r) => r.flush(manual));
    http.match('/api/categories').forEach((r) => r.flush(categories));
    http.match('/api/subcategory-shares').forEach((r) => r.flush({ shares: [] }));
    http.match('/api/household-ratio').forEach((r) => r.flush({ entries: [] }));
  }

  function openedForm() {
    http.expectOne('/api/categories').flush(categories);
    http.expectOne('/api/subcategory-shares').flush({ shares: [] });
  }

  it('adds a transaction without leaving the list, which then updates', async () => {
    await harness.navigateByUrl('/transaktioner');
    emptyList();
    await settle();
    expect(document.querySelector('[data-sheet]')).toBeNull();

    (page().querySelector('[data-add]') as HTMLAnchorElement).click();
    await settle();
    openedForm();
    await settle();
    expect(document.querySelector('[data-sheet]')).not.toBeNull();

    fill('[data-description]', 'ICA Maxi');
    fill('[data-amount]', '300');
    (document.querySelector('[data-category-tile="1"]') as HTMLElement).click();
    await settle();
    (document.querySelector('[data-subcategory="11"]') as HTMLElement).click();
    await settle();
    (document.querySelector('[data-save]') as HTMLButtonElement).click();
    http.expectOne({ method: 'POST', url: '/api/transactions' }).flush({ id: 9 });
    await settle();

    // The list is fetched again, the sheet is gone and a toast says it worked.
    emptyList();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/transaktioner');
    expect(document.querySelector('[data-sheet]')).toBeNull();
    expect(TestBed.inject(ToastService).message()).toBe('Transaktionen sparades');
  });

  it('opens from the /transaktioner/ny deep link and closes back to the list', async () => {
    await harness.navigateByUrl('/transaktioner/ny');
    emptyList();
    openedForm();
    await settle();
    expect(document.querySelector('[data-sheet]')).not.toBeNull();

    (document.querySelector('[data-cancel]') as HTMLButtonElement).click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/transaktioner');
    expect(document.querySelector('[data-sheet]')).toBeNull();
  });

  it('edits from the /transaktioner/:id/redigera deep link, over the transaction', async () => {
    await harness.navigateByUrl('/transaktioner/5/redigera');
    await settle();
    answer();
    await settle();
    answer();
    await settle();
    expect(document.querySelector('[data-sheet]')).not.toBeNull();
    expect(page().querySelector('[data-summary]')).not.toBeNull();

    fill('[data-amount]', '350');
    (document.querySelector('[data-save]') as HTMLButtonElement).click();
    http.expectOne({ method: 'PUT', url: '/api/transactions/5' }).flush({ id: 5 });
    await settle();

    answer();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/transaktioner/5');
    expect(document.querySelector('[data-sheet]')).toBeNull();
  });
});
