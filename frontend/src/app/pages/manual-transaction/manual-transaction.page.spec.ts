import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import type { CategoriesResponse, TransactionDetails } from '@bankapp/shared';
import { ManualTransactionPage } from './manual-transaction.page';

const categories: CategoriesResponse = {
  categories: [
    {
      id: 1,
      name: 'Mat',
      kind: 'expense',
      colour: 'green',
      icon: 'shopping-cart',
      fixed: false,
      subcategories: [{ id: 11, name: 'Livsmedel', icon: 'shopping-cart', share: null }],
    },
  ],
} as unknown as CategoriesResponse;

describe('ManualTransactionPage', () => {
  function setup(id: string | null) {
    TestBed.configureTestingModule({
      imports: [ManualTransactionPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap(id === null ? {} : { id }) } },
        },
      ],
    });
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function render() {
    const fixture = TestBed.createComponent(ManualTransactionPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/categories').flush(categories);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement, http };
  }

  function fill(page: HTMLElement, selector: string, value: string, event = 'input') {
    const el = page.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    el.value = value;
    el.dispatchEvent(new Event(event));
  }

  it('adds an expense as a negative amount, dated today by default', async () => {
    setup(null);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { fixture, page, http } = await render();
    const save = page.querySelector('[data-save]') as HTMLButtonElement;
    expect((page.querySelector('[data-date]') as HTMLInputElement).value).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    fill(page, '[data-description]', 'ICA Maxi');
    fill(page, '[data-amount]', '300');
    fill(page, '[data-subcategory]', '11', 'change');
    fill(page, '[data-share]', 'half', 'change');
    await fixture.whenStable();
    expect(save.disabled).toBe(false);
    save.click();

    const request = http.expectOne('/api/transactions');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({
      description: 'ICA Maxi',
      amount: -300,
      subcategoryId: 11,
      share: 'half',
    });
    request.flush({ id: 9 });
    expect(navigate).toHaveBeenCalledWith(['/transaktioner', 9]);
  });

  it('adds a transaction paid by the partner, and edits it starting from that', async () => {
    setup(null);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { fixture, page, http } = await render();
    expect((page.querySelector('[data-paid-by]') as HTMLSelectElement).value).toBe('owner');
    fill(page, '[data-description]', 'Hyra');
    fill(page, '[data-amount]', '100');
    fill(page, '[data-subcategory]', '11', 'change');
    fill(page, '[data-paid-by]', 'partner', 'change');
    await fixture.whenStable();
    (page.querySelector('[data-save]') as HTMLButtonElement).click();
    const request = http.expectOne('/api/transactions');
    expect(request.request.body).toMatchObject({ amount: -100, paidBy: 'partner' });
    request.flush({ id: 9 });
  });

  it('starts an edit from who paid', async () => {
    setup('5');
    const { fixture, page, http } = await render();
    http.expectOne('/api/transactions/5').flush({
      id: 5,
      description: 'Hyra',
      amount: { amount: -100, currency: 'SEK' },
      account: null,
      transactionDate: '2026-11-10',
      category: { subcategory: { id: 11 }, category: { id: 1 }, confirmed: true },
      share: { option: 'half', percent: 50, source: 'transaction' },
      paidBy: 'partner',
    } as unknown as TransactionDetails);
    await fixture.whenStable();
    expect((page.querySelector('[data-paid-by]') as HTMLSelectElement).value).toBe('partner');
    (page.querySelector('[data-save]') as HTMLButtonElement).click();
    const request = http.expectOne('/api/transactions/5');
    expect(request.request.body).toMatchObject({ paidBy: 'partner' });
    request.flush({ id: 5 });
  });

  it('cannot be saved before everything is filled in', async () => {
    setup(null);
    const { page } = await render();

    expect((page.querySelector('[data-save]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('edits a manual transaction, starting from what it has', async () => {
    setup('5');
    const { fixture, page, http } = await render();
    http.expectOne('/api/transactions/5').flush({
      id: 5,
      description: 'ICA Maxi',
      amount: { amount: -300, currency: 'SEK' },
      account: null,
      transactionDate: '2026-11-10',
      category: { subcategory: { id: 11 }, category: { id: 1 }, confirmed: true },
      share: { option: 'half', percent: 50, source: 'transaction' },
    } as unknown as TransactionDetails);
    await fixture.whenStable();

    expect((page.querySelector('[data-description]') as HTMLInputElement).value).toBe('ICA Maxi');
    expect((page.querySelector('[data-amount]') as HTMLInputElement).value).toBe('300');
    expect((page.querySelector('[data-date]') as HTMLInputElement).value).toBe('2026-11-10');
    fill(page, '[data-amount]', '350');
    await fixture.whenStable();
    (page.querySelector('[data-save]') as HTMLButtonElement).click();

    const request = http.expectOne('/api/transactions/5');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toMatchObject({ amount: -350, subcategoryId: 11, share: 'half' });
    request.flush({ id: 5 });
  });

  it('does not edit a bank transaction', async () => {
    setup('5');
    const { fixture, page, http } = await render();
    http.expectOne('/api/transactions/5').flush({
      id: 5,
      account: { id: 1, name: 'x', bank: 'y', type: 'payment' },
    } as unknown as TransactionDetails);
    await fixture.whenStable();

    expect(page.querySelector('[data-form]')).toBeNull();
  });
});
