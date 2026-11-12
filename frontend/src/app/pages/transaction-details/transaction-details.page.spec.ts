import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { CategoriesResponse, TransactionCategory, TransactionDetails } from '@bankapp/shared';
import { TransactionsService } from '../../transactions.service';
import { TransactionDetailsPage } from './transaction-details.page';

describe('TransactionDetailsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TransactionDetailsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: '5' }) } },
        },
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const details = (overrides: Partial<TransactionDetails> = {}): TransactionDetails => ({
    id: 5,
    status: 'booked',
    amount: { amount: -12.5, currency: 'SEK' },
    description: 'Lunch Rom',
    account: { id: 7, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
    category: null,
    transactionDate: null,
    bookingDate: null,
    counterparty: null,
    originalAmount: null,
    exchangeRate: null,
    remittanceInformation: [],
    referenceNumber: null,
    note: null,
    raw: '{"a":1}',
    ...overrides,
  });

  async function render(response: TransactionDetails | { httpStatus: number }) {
    const fixture = TestBed.createComponent(TransactionDetailsPage);
    await fixture.whenStable();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/transactions/5');
    if ('httpStatus' in response) {
      request.flush('', { status: response.httpStatus, statusText: 'x' });
    } else request.flush(response);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const field = (key: string) =>
      page.querySelector(`[data-field="${key}"]`)?.textContent?.trim() ?? null;
    return { fixture, page, field };
  }

  it('shows the details in Swedish', async () => {
    const { page, field } = await render(
      details({
        status: 'pending',
        transactionDate: '2026-11-08',
        bookingDate: '2026-11-10',
        counterparty: 'Café Roma',
        originalAmount: { amount: -1.12, currency: 'EUR' },
        exchangeRate: 11.2,
        remittanceInformation: ['Lunch', 'Rome'],
        referenceNumber: '12345',
        note: 'Team trip',
      }),
    );

    expect(page.querySelector('[data-description]')?.textContent?.trim()).toBe('Lunch Rom');
    expect(page.querySelector('[data-amount]')?.textContent?.trim()).toMatch(/^−12,50\skr$/);
    expect(field('status')).toBe('Reserverad');
    expect(field('bank')).toBe('Swedbank');
    expect(field('account')).toBe('Lönekonto (Betalkonto)');
    expect(field('transactionDate')).toBe('Söndag 8 november 2026');
    expect(field('bookingDate')).toBe('Tisdag 10 november 2026');
    expect(field('counterparty')).toBe('Café Roma');
    expect(field('originalAmount')).toMatch(/^−1,12\s€$/);
    expect(field('exchangeRate')).toBe('11,2');
    expect(field('remittanceInformation')).toBe('Lunch Rome');
    expect(field('referenceNumber')).toBe('12345');
    expect(field('note')).toBe('Team trip');
  });

  it('shows Bokförd for booked transactions and hides what the bank did not send', async () => {
    const { page, field } = await render(details());

    expect(field('status')).toBe('Bokförd');
    const shown = Array.from(page.querySelectorAll('[data-field]')).map((d) =>
      d.getAttribute('data-field'),
    );
    expect(shown).toEqual(['status', 'bank', 'account']);
  });

  describe('category', () => {
    const livsmedel: TransactionCategory = {
      category: { id: 2, name: 'Mat & Dryck', colour: 'green' },
      subcategory: { id: 12, name: 'Livsmedel', icon: 'shopping-basket' },
      confirmed: true,
    };

    const categoryText = (page: HTMLElement) =>
      page.querySelector('[data-category-name]')?.textContent?.replace(/\s+/g, ' ').trim();

    it('shows the category and subcategory with its icon', async () => {
      const { page } = await render(details({ category: livsmedel }));

      expect(categoryText(page)).toBe('Mat & Dryck / Livsmedel');
      expect(page.querySelector('[data-category] [data-badge]')?.getAttribute('aria-label')).toBe(
        'Livsmedel',
      );
    });

    it('shows a guessed category dimmed and confirms it with one tap', async () => {
      const service = TestBed.inject(TransactionsService);
      const guess = { ...livsmedel, confirmed: false };
      service.listed = {
        transactions: [{ ...details(), date: '2026-11-08', category: guess }],
        cursor: null,
      };
      const rendered = await render(details({ category: guess }));
      const { page } = rendered;

      expect(page.querySelector('[data-category] [data-guessed]')).not.toBeNull();
      expect(page.querySelector('[data-category-guessed-note]')?.textContent?.trim()).toBe(
        'Gissad',
      );

      (page.querySelector('[data-confirm-category]') as HTMLButtonElement).click();
      const request = TestBed.inject(HttpTestingController).expectOne(
        '/api/transactions/5/category',
      );
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ subcategoryId: 12 });
      request.flush({ category: livsmedel, updatedSimilar: 0 });
      await rendered.fixture.whenStable();

      expect(page.querySelector('[data-category] [data-guessed]')).toBeNull();
      expect(page.querySelector('[data-confirm-category]')).toBeNull();
      expect(page.querySelector('[data-category-guessed-note]')).toBeNull();
      expect(service.listed?.transactions[0]?.category).toEqual(livsmedel);
    });

    it('says how many similar transactions were updated, if any', async () => {
      const rendered = await render(details({ category: { ...livsmedel, confirmed: false } }));
      const { page } = rendered;
      expect(page.querySelector('[data-similar-updated]')).toBeNull();

      (page.querySelector('[data-confirm-category]') as HTMLButtonElement).click();
      TestBed.inject(HttpTestingController)
        .expectOne('/api/transactions/5/category')
        .flush({ category: livsmedel, updatedSimilar: 1 });
      await rendered.fixture.whenStable();
      rendered.fixture.detectChanges();

      expect(page.querySelector('[data-similar-updated]')?.textContent?.trim()).toBe(
        '1 liknande transaktion uppdaterades',
      );
    });

    it('offers no Stämmer for a confirmed category', async () => {
      const { page } = await render(details({ category: livsmedel }));

      expect(page.querySelector('[data-confirm-category]')).toBeNull();
      expect(page.querySelector('[data-category] [data-guessed]')).toBeNull();
    });

    it('says Okategoriserad when there is none', async () => {
      const { page } = await render(details());

      expect(categoryText(page)).toBe('Okategoriserad');
      expect(page.querySelector('[data-category] [data-uncategorised]')).not.toBeNull();
    });

    const restaurang: TransactionCategory = {
      category: { id: 2, name: 'Mat & Dryck', colour: 'green' },
      subcategory: { id: 13, name: 'Restaurang', icon: 'utensils-crossed' },
      confirmed: true,
    };

    const categories: CategoriesResponse = {
      categories: [
        {
          id: 2,
          name: 'Mat & Dryck',
          kind: 'expense',
          colour: 'green',
          icon: 'utensils',
          fixed: false,
          subcategories: [
            { id: 12, name: 'Livsmedel', icon: 'shopping-basket' },
            { id: 13, name: 'Restaurang', icon: 'utensils-crossed' },
            { id: 16, name: 'Övrigt', icon: 'circle-ellipsis' },
          ],
        },
        {
          id: 3,
          name: 'Transport',
          kind: 'expense',
          colour: 'blue',
          icon: 'bus',
          fixed: false,
          subcategories: [
            { id: 20, name: 'Kollektivtrafik', icon: 'train-front' },
            { id: 21, name: 'Taxi', icon: 'car-taxi-front' },
          ],
        },
      ],
    };

    async function openPicker(rendered: Awaited<ReturnType<typeof render>>) {
      (rendered.page.querySelector('[data-category-button]') as HTMLButtonElement).click();
      await rendered.fixture.whenStable();
      TestBed.inject(HttpTestingController).expectOne('/api/categories').flush(categories);
      await rendered.fixture.whenStable();
    }

    const pickerGroups = (page: HTMLElement) =>
      Array.from(page.querySelectorAll('[data-picker-category]')).map((group) => ({
        name: group.querySelector('[data-picker-category-name]')?.textContent?.trim(),
        subcategories: Array.from(group.querySelectorAll('[data-subcategory]')).map((button) =>
          button.textContent?.trim(),
        ),
      }));

    async function search(rendered: Awaited<ReturnType<typeof render>>, text: string) {
      const input = rendered.page.querySelector('[data-category-search]') as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await rendered.fixture.whenStable();
    }

    it('opens a picker with the subcategories grouped under their categories, in order, with icons', async () => {
      const rendered = await render(details());
      expect(rendered.page.querySelector('[data-picker]')).toBeNull();

      await openPicker(rendered);

      expect(pickerGroups(rendered.page)).toEqual([
        { name: 'Mat & Dryck', subcategories: ['Livsmedel', 'Restaurang', 'Övrigt'] },
        { name: 'Transport', subcategories: ['Kollektivtrafik', 'Taxi'] },
      ]);
      const taxi = rendered.page.querySelector('[data-subcategory="21"]');
      expect(taxi?.querySelector('[data-badge]')?.getAttribute('style')).toContain('--category');
    });

    it('searches category and subcategory names, ignoring case', async () => {
      const rendered = await render(details());
      await openPicker(rendered);

      await search(rendered, 'TAXI');
      expect(pickerGroups(rendered.page)).toEqual([{ name: 'Transport', subcategories: ['Taxi'] }]);

      await search(rendered, 'mat &');
      expect(pickerGroups(rendered.page)).toEqual([
        { name: 'Mat & Dryck', subcategories: ['Livsmedel', 'Restaurang', 'Övrigt'] },
      ]);

      await search(rendered, 'övr');
      expect(pickerGroups(rendered.page)).toEqual([
        { name: 'Mat & Dryck', subcategories: ['Övrigt'] },
      ]);

      await search(rendered, 'xyz');
      expect(pickerGroups(rendered.page)).toEqual([]);
      expect(rendered.page.querySelector('[data-picker-empty]')?.textContent?.trim()).toBe(
        'Inga träffar',
      );
    });

    it('saves the chosen subcategory as confirmed and shows it, also in the list kept for the way back', async () => {
      const service = TestBed.inject(TransactionsService);
      const listed = { ...details(), date: '2026-11-08', category: livsmedel };
      service.listed = { transactions: [listed], cursor: null };
      const rendered = await render(details({ category: livsmedel }));
      await openPicker(rendered);

      (rendered.page.querySelector('[data-subcategory="13"]') as HTMLButtonElement).click();
      const request = TestBed.inject(HttpTestingController).expectOne(
        '/api/transactions/5/category',
      );
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ subcategoryId: 13 });
      request.flush({ category: restaurang, updatedSimilar: 0 });
      await rendered.fixture.whenStable();

      expect(categoryText(rendered.page)).toBe('Mat & Dryck / Restaurang');
      expect(rendered.page.querySelector('[data-picker]')).toBeNull();
      expect(service.listed?.transactions[0]?.category).toEqual(restaurang);
    });

    it('removes the category, making the transaction uncategorised', async () => {
      const rendered = await render(details({ category: livsmedel }));

      (rendered.page.querySelector('[data-remove-category]') as HTMLButtonElement).click();
      const request = TestBed.inject(HttpTestingController).expectOne(
        '/api/transactions/5/category',
      );
      expect(request.request.body).toEqual({ subcategoryId: null });
      request.flush({ category: null, updatedSimilar: 0 });
      await rendered.fixture.whenStable();

      expect(categoryText(rendered.page)).toBe('Okategoriserad');
      expect(rendered.page.querySelector('[data-remove-category]')).toBeNull();
    });

    it('says so when the categories cannot be fetched, and tries again on the next tap', async () => {
      const rendered = await render(details());
      const button = rendered.page.querySelector('[data-category-button]') as HTMLButtonElement;
      const http = TestBed.inject(HttpTestingController);

      button.click();
      await rendered.fixture.whenStable();
      http.expectOne('/api/categories').flush('', { status: 500, statusText: 'x' });
      await rendered.fixture.whenStable();
      expect(rendered.page.querySelector('[role="alert"]')?.textContent).toContain(
        'Kategorierna kunde inte hämtas',
      );
      expect(rendered.page.querySelector('[data-picker]')).toBeNull();

      button.click();
      await rendered.fixture.whenStable();
      http.expectOne('/api/categories').flush(categories);
      await rendered.fixture.whenStable();
      expect(rendered.page.querySelector('[role="alert"]')).toBeNull();
      expect(rendered.page.querySelector('[data-picker]')).not.toBeNull();
    });

    it('keeps the category and says so when it cannot be saved', async () => {
      const rendered = await render(details({ category: livsmedel }));
      await openPicker(rendered);

      (rendered.page.querySelector('[data-subcategory="13"]') as HTMLButtonElement).click();
      TestBed.inject(HttpTestingController)
        .expectOne('/api/transactions/5/category')
        .flush('', { status: 500, statusText: 'x' });
      await rendered.fixture.whenStable();

      expect(categoryText(rendered.page)).toBe('Mat & Dryck / Livsmedel');
      expect(rendered.page.querySelector('[role="alert"]')?.textContent).toContain(
        'Kategorin kunde inte sparas',
      );
    });
  });

  it('has a collapsed Rådata section with pretty-printed JSON', async () => {
    const { page } = await render(details({ raw: '{"a":{"b":1}}' }));

    const raw = page.querySelector('details[data-raw]') as HTMLDetailsElement;
    expect(raw.open).toBe(false);
    expect(raw.querySelector('summary')?.textContent?.trim()).toBe('Rådata');
    expect(raw.querySelector('[data-raw-json]')?.textContent).toBe(
      JSON.stringify({ a: { b: 1 } }, null, 2),
    );
  });

  it('says the transaction is gone, with a link to the list, when the id is unknown', async () => {
    const { page } = await render({ httpStatus: 404 });

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Transaktionen finns inte längre');
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/transaktioner');
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an error for other failures', async () => {
    const { page } = await render({ httpStatus: 500 });

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('kunde inte hämtas');
  });

  it('goes back in history when the owner came from the list', async () => {
    const { fixture, page } = await render(details());
    const back = vi.spyOn(TestBed.inject(Location), 'back').mockImplementation(() => {});
    const router = TestBed.inject((await import('@angular/router')).Router);
    await router.navigateByUrl('/a');
    await router.navigateByUrl('/b');

    (page.querySelector('[data-back]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(back).toHaveBeenCalled();
  });
});
