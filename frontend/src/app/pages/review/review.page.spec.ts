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

  afterEach(() => {
    // Every change makes the service fetch the review count again.
    TestBed.inject(HttpTestingController)
      .match('/api/transactions/review/count')
      .forEach((r) => (r.cancelled ? undefined : r.flush({ count: 0 })));
    TestBed.inject(HttpTestingController).verify();
  });

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
    ownerPart: -10,
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

  /** Ids of the rows still open; a row collapsing away after being handled does not count. */
  const ids = (root: ParentNode) =>
    Array.from(root.querySelectorAll('li[data-transaction]:not([data-leaving])')).map((li) =>
      li.getAttribute('data-id'),
    );

  it('lists guesses before uncategorised transactions in one Bekräfta kategori section', async () => {
    const { page } = await render({
      count: 4,
      transactions: [
        transaction(4, { category: guess }),
        transaction(3),
        transaction(2, { category: guess }),
        transaction(1),
      ],
    });

    const section = page.querySelector('section[data-categories]') as HTMLElement;
    expect(section.querySelector('h2')?.textContent?.trim()).toBe('Bekräfta kategori');
    expect(section.querySelector('[data-section-count]')?.textContent?.trim()).toBe(
      '4 gissade eller okategoriserade',
    );
    expect(ids(section)).toEqual(['4', '2', '3', '1']);
  });

  it('labels the guess, or says there is none', async () => {
    const { page } = await render({
      count: 2,
      transactions: [transaction(2, { category: guess }), transaction(1)],
    });

    expect(page.querySelector('li[data-id="2"] [data-guess-tag]')?.textContent?.trim()).toBe(
      'Gissad: Livsmedel',
    );
    expect(page.querySelector('li[data-id="2"] [data-guess-tag] [data-guess-mark]')).toBeNull();
    expect(page.querySelector('li[data-id="1"] [data-guess-tag]')?.textContent?.trim()).toBe(
      'Ingen gissning',
    );
    expect(page.querySelector('li[data-id="2"] [data-change]')?.textContent?.trim()).toBe('Ändra');
    expect(page.querySelector('li[data-id="1"] [data-change]')?.textContent?.trim()).toBe(
      'Välj kategori',
    );
  });

  it('says how many are left and how far along the visit is', async () => {
    const { fixture, page, http } = await render({
      count: 4,
      transactions: [
        transaction(4, { category: guess }),
        transaction(3, { category: guess }),
        transaction(2),
        transaction(1),
      ],
    });
    const bar = () => page.querySelector('[data-progress]') as HTMLElement;

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Att granska');
    expect(page.querySelector('[data-remaining]')?.textContent?.trim()).toBe('4 kvar att bekräfta');
    expect(bar().getAttribute('aria-valuenow')).toBe('0');
    expect(bar().getAttribute('aria-valuemax')).toBe('4');

    (page.querySelector('li[data-id="4"] [data-confirm]') as HTMLButtonElement).click();
    http
      .expectOne('/api/transactions/4/category')
      .flush({ category: { ...guess, confirmed: true }, updatedSimilar: 0, others: [] });
    await fixture.whenStable();

    expect(page.querySelector('[data-remaining]')?.textContent?.trim()).toBe('3 kvar att bekräfta');
    expect(bar().getAttribute('aria-valuenow')).toBe('1');
    expect(bar().getAttribute('aria-valuemax')).toBe('4');
  });

  describe('long lists', () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => transaction(13 - i));

    it('shows the first 5 and a Visa alla button, and keeps 5 showing as rows are confirmed', async () => {
      const { fixture, page, http } = await render({ count: 13, transactions: thirteen });
      expect(ids(page)).toEqual(['13', '12', '11', '10', '9']);
      expect(page.querySelector('[data-show-all]')?.textContent?.trim()).toBe('Visa alla 13');

      (page.querySelector('li[data-id="13"] [data-change]') as HTMLButtonElement).click();
      await fixture.whenStable();
      http.expectOne('/api/categories').flush(categories);
      await fixture.whenStable();
      (page.querySelector('li[data-id="13"] [data-subcategory="13"]') as HTMLButtonElement).click();
      http
        .expectOne('/api/transactions/13/category')
        .flush({ category: { ...guess, confirmed: true }, updatedSimilar: 0, others: [] });
      await fixture.whenStable();

      expect(ids(page)).toEqual(['12', '11', '10', '9', '8']);
      expect(page.querySelector('[data-show-all]')?.textContent?.trim()).toBe('Visa alla 12');
    });

    it('shows every row after Visa alla', async () => {
      const { fixture, page } = await render({ count: 13, transactions: thirteen });

      (page.querySelector('[data-show-all]') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(ids(page)).toHaveLength(13);
      expect(page.querySelector('[data-show-all]')).toBeNull();
    });
  });

  it('collapses a confirmed row away before removing it', async () => {
    const { fixture, page, http } = await render({
      count: 1,
      transactions: [transaction(1, { category: guess })],
    });
    vi.useFakeTimers();
    try {
      (page.querySelector('[data-confirm]') as HTMLButtonElement).click();
      http
        .expectOne('/api/transactions/1/category')
        .flush({ category: { ...guess, confirmed: true }, updatedSimilar: 0, others: [] });
      await vi.advanceTimersByTimeAsync(0);
      fixture.detectChanges();
      expect(page.querySelector('li[data-id="1"]')?.hasAttribute('data-leaving')).toBe(true);

      await vi.advanceTimersByTimeAsync(500);
      fixture.detectChanges();
      expect(page.querySelector('li[data-id="1"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
    request.flush({ category: { ...guess, confirmed: true }, updatedSimilar: 0, others: [] });
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
      .flush({ category: { ...guess, confirmed: true }, updatedSimilar: 2, others: [] });
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
      .flush({ category: { ...guess, confirmed: true }, updatedSimilar: 0, others: [] });
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

  it('celebrates when nothing is left to review, with a way back to the overview', async () => {
    const { page } = await render({ count: 0, transactions: [] });

    expect(page.querySelector('[data-empty]')?.textContent).toContain('Allt är granskat');
    expect(page.querySelector('[data-empty] a')?.getAttribute('href')).toBe('/');
    expect(page.querySelector('[data-empty] a')?.textContent?.trim()).toBe('Till översikten');
    expect(page.querySelector('[data-progress]')).toBeNull();
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

    it('shows both rows with Ersätt med banktransaktionen and Inte samma', async () => {
      const { page } = await render({ count: 1, transactions: [], replacements: [pair] });

      const rows = Array.from(page.querySelectorAll('[data-replacement-row]')).map((row) =>
        row.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(rows[0]).toContain('Coop');
      expect(rows[0]).toContain('Manuell');
      expect(rows[1]).toContain('COOP KONSUM');
      expect(page.querySelector('[data-replace]')?.textContent?.trim()).toBe(
        'Ersätt med banktransaktionen',
      );
      expect(page.querySelector('[data-not-same]')?.textContent?.trim()).toBe('Inte samma');
      expect(page.querySelector('[data-empty]')).toBeNull();
      expect(page.querySelector('[data-section-count]')?.textContent?.trim()).toBe(
        '1 förslag · en manuell transaktion som verkar ha kommit från banken',
      );
      expect(page.querySelector('[data-remaining]')?.textContent?.trim()).toBe(
        '1 kvar att bekräfta',
      );
    });

    it('leaves the section out when there are no suggestions', async () => {
      const { page } = await render({ count: 1, transactions: [transaction(1)] });
      expect(page.querySelector('[data-replacements]')).toBeNull();
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

      expect(page.querySelector('[data-replacement]:not([data-leaving])')).toBeNull();
      expect(page.querySelector('[data-replacement]')?.hasAttribute('data-leaving')).toBe(true);
      expect(page.querySelector('[data-remaining]')).toBeNull();
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

      expect(page.querySelector('[data-replacement]:not([data-leaving])')).toBeNull();
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
