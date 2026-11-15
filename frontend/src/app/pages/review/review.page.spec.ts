import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  CategoriesResponse,
  Transaction,
  TransactionCategory,
  TransactionReviewResponse,
} from '@bankapp/shared';
import { TransactionsService } from '../../transactions.service';
import { ReviewPage } from './review.page';

describe('ReviewPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReviewPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const guess: TransactionCategory = {
    category: { id: 2, name: 'Mat & Dryck', colour: 'green' },
    subcategory: { id: 12, name: 'Livsmedel', icon: 'shopping-basket' },
    confirmed: false,
  };

  const transaction = (id: number, overrides: Partial<Transaction> = {}): Transaction => ({
    id,
    status: 'booked',
    amount: { amount: -10, currency: 'SEK' },
    date: '2026-11-10',
    description: `Köp ${id}`,
    account: { id: 7, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
    category: null,
    share: { option: 'me', percent: 100, source: 'default' },
    paidBy: 'owner',
    ...overrides,
  });

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
        ],
      },
    ],
  };

  type Body = Omit<TransactionReviewResponse, 'replacements'> &
    Partial<Pick<TransactionReviewResponse, 'replacements'>>;

  async function render(body: Body | 'error') {
    const fixture = TestBed.createComponent(ReviewPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne('/api/transactions/review');
    if (body === 'error') request.error(new ProgressEvent('error'));
    else request.flush({ replacements: [], ...body });
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement, http };
  }

  const ids = (root: ParentNode) =>
    Array.from(root.querySelectorAll('li[data-transaction]')).map((li) =>
      li.getAttribute('data-id'),
    );

  it('lists guesses and uncategorised transactions in two groups, newest first', async () => {
    const { page } = await render({
      count: 3,
      transactions: [
        transaction(4, { category: guess }),
        transaction(3),
        transaction(2, { category: guess }),
        transaction(1),
      ],
    });

    const groups = Array.from(page.querySelectorAll('section[data-group]')).map((section) => ({
      heading: section.querySelector('h2')?.textContent?.trim(),
      ids: ids(section),
    }));
    expect(groups).toEqual([
      { heading: 'Gissade', ids: ['4', '2'] },
      { heading: 'Okategoriserade', ids: ['3', '1'] },
    ]);
  });

  it('leaves out a group that has nothing in it', async () => {
    const { page } = await render({ count: 1, transactions: [transaction(1)] });

    expect(Array.from(page.querySelectorAll('h2')).map((h) => h.textContent?.trim())).toEqual([
      'Okategoriserade',
    ]);
  });

  it('offers one-tap confirm on guesses only', async () => {
    const { page } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
    });

    expect(page.querySelector('li[data-id="2"] [data-confirm]')).not.toBeNull();
    expect(page.querySelector('li[data-id="1"] [data-confirm]')).toBeNull();
  });

  it('confirms a guess with one tap, and the row leaves the list and the count drops', async () => {
    const { fixture, page, http } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
    });
    const service = TestBed.inject(TransactionsService);
    expect(service.reviewCount()).toBe(2);

    (page.querySelector('li[data-id="2"] [data-confirm]') as HTMLButtonElement).click();
    const request = http.expectOne('/api/transactions/2/category');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ subcategoryId: 12 });
    request.flush({ category: { ...guess, confirmed: true }, updatedSimilar: 0 });
    await fixture.whenStable();

    expect(ids(page)).toEqual(['1']);
    expect(service.reviewCount()).toBe(1);
  });

  it('says how many similar transactions were updated, and shows their new guess', async () => {
    const { fixture, page, http } = await render({
      count: 3,
      transactions: [
        transaction(3, { category: guess }),
        transaction(2, { category: guess }),
        transaction(1),
      ],
    });

    (page.querySelector('li[data-id="3"] [data-confirm]') as HTMLButtonElement).click();
    http
      .expectOne('/api/transactions/3/category')
      .flush({ category: { ...guess, confirmed: true }, updatedSimilar: 2 });
    http.expectOne('/api/transactions/review').flush({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1, { category: guess })],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(page.querySelector('[data-similar-updated]')?.textContent?.trim()).toBe(
      '2 liknande transaktioner uppdaterades',
    );
    expect(ids(page)).toEqual(['2', '1']);
  });

  it('sets a category from the inline picker, for a guess as well as an uncategorised row', async () => {
    const { fixture, page, http } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
    });

    (page.querySelector('li[data-id="1"] [data-change]') as HTMLButtonElement).click();
    await fixture.whenStable();
    http.expectOne('/api/categories').flush(categories);
    await fixture.whenStable();
    (page.querySelector('li[data-id="1"] [data-subcategory="13"]') as HTMLButtonElement).click();
    const request = http.expectOne('/api/transactions/1/category');
    expect(request.request.body).toEqual({ subcategoryId: 13 });
    request.flush({
      category: {
        ...guess,
        subcategory: { id: 13, name: 'Restaurang', icon: 'utensils-crossed' },
        confirmed: true,
      },
    });
    await fixture.whenStable();
    expect(ids(page)).toEqual(['2']);

    (page.querySelector('li[data-id="2"] [data-change]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(page.querySelector('li[data-id="2"] [data-picker]')).not.toBeNull();
    (page.querySelector('li[data-id="2"] [data-subcategory="13"]') as HTMLButtonElement).click();
    http
      .expectOne('/api/transactions/2/category')
      .flush({ category: { ...guess, confirmed: true }, updatedSimilar: 0 });
    await fixture.whenStable();
    expect(ids(page)).toEqual([]);
  });

  it('keeps the row and says so when saving fails', async () => {
    const { fixture, page, http } = await render({
      count: 1,
      transactions: [transaction(2, { category: guess })],
    });

    (page.querySelector('[data-confirm]') as HTMLButtonElement).click();
    http.expectOne('/api/transactions/2/category').error(new ProgressEvent('error'));
    await fixture.whenStable();

    expect(ids(page)).toEqual(['2']);
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('kunde inte sparas');
  });

  it('says so when nothing is left to review', async () => {
    const { page } = await render({ count: 0, transactions: [] });

    expect(page.querySelector('[data-empty]')?.textContent?.trim()).toBe(
      'Inget att granska just nu.',
    );
  });

  describe('suggested replacements', () => {
    const pair = {
      manual: transaction(1, {
        description: 'Coop',
        amount: { amount: -245, currency: 'SEK' },
        account: null,
        category: { ...guess, confirmed: true },
      }),
      bank: transaction(2, {
        description: 'COOP KONSUM',
        amount: { amount: -247.5, currency: 'SEK' },
      }),
    };

    it('shows both rows with Ersätt and Inte samma', async () => {
      const { page } = await render({ count: 1, transactions: [], replacements: [pair] });

      const rows = Array.from(page.querySelectorAll('[data-replacement-row]')).map((row) =>
        row.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(rows[0]).toContain('Coop');
      expect(rows[0]).toContain('Manuell');
      expect(rows[1]).toContain('COOP KONSUM');
      expect(page.querySelector('[data-replace]')?.textContent?.trim()).toBe('Ersätt');
      expect(page.querySelector('[data-not-same]')?.textContent?.trim()).toBe('Inte samma');
      expect(page.querySelector('[data-empty]')).toBeNull();
    });

    it('replaces the manual transaction and fetches the list again', async () => {
      const { fixture, page, http } = await render({
        count: 1,
        transactions: [],
        replacements: [pair],
      });

      (page.querySelector('[data-replace]') as HTMLButtonElement).click();
      const request = http.expectOne('/api/transactions/replace');
      expect(request.request.body).toEqual({ manualId: 1, bankId: 2 });
      request.flush(null, { status: 204, statusText: 'No Content' });
      http
        .expectOne('/api/transactions/review')
        .flush({ count: 0, transactions: [], replacements: [] });
      await fixture.whenStable();

      expect(page.querySelector('[data-replacement]')).toBeNull();
      expect(page.querySelector('[data-empty]')).not.toBeNull();
      expect(TestBed.inject(TransactionsService).reviewCount()).toBe(0);
    });

    it('stores Inte samma and drops the pair', async () => {
      const { fixture, page, http } = await render({
        count: 1,
        transactions: [],
        replacements: [pair],
      });

      (page.querySelector('[data-not-same]') as HTMLButtonElement).click();
      const request = http.expectOne('/api/transactions/not-same');
      expect(request.request.body).toEqual({ manualId: 1, bankId: 2 });
      request.flush(null, { status: 204, statusText: 'No Content' });
      http
        .expectOne('/api/transactions/review')
        .flush({ count: 0, transactions: [], replacements: [] });
      await fixture.whenStable();

      expect(page.querySelector('[data-replacement]')).toBeNull();
    });

    it('keeps the pair and says so when saving fails', async () => {
      const { fixture, page, http } = await render({
        count: 1,
        transactions: [],
        replacements: [pair],
      });

      (page.querySelector('[data-replace]') as HTMLButtonElement).click();
      http.expectOne('/api/transactions/replace').error(new ProgressEvent('error'));
      await fixture.whenStable();

      expect(page.querySelector('[data-replacement]')).not.toBeNull();
      expect(page.querySelector('[role="alert"]')?.textContent).toContain(
        'Det gick inte att spara',
      );
    });
  });

  it('says so when the list cannot be fetched', async () => {
    const { page } = await render('error');

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('kunde inte hämtas');
  });
});
