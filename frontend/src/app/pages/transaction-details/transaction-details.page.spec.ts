import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { CategoriesResponse, TransactionCategory, TransactionDetails } from '@bankapp/shared';
import { of } from 'rxjs';
import { ToastService } from '../../toast/toast.service';
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
          useValue: { paramMap: of(convertToParamMap({ id: '5' })), url: of([]) },
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
    share: { option: 'me', percent: 100, source: 'default' },
    ownerPart: -12.5,
    paidBy: 'owner',
    transactionDate: null,
    bookingDate: null,
    counterparty: null,
    originalAmount: null,
    exchangeRate: null,
    remittanceInformation: [],
    referenceNumber: null,
    note: null,
    offsets: null,
    refunds: [],
    netAmount: null,
    raw: '{"a":1}',
    ...overrides,
  });

  async function render(
    response: TransactionDetails | { httpStatus: number },
    ratio: { from: string; percent: number }[] = [{ from: '2026-01-01', percent: 60 }],
  ) {
    const fixture = TestBed.createComponent(TransactionDetailsPage);
    await fixture.whenStable();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/transactions/5');
    if ('httpStatus' in response) {
      request.flush('', { status: response.httpStatus, statusText: 'x' });
    } else {
      request.flush(response);
      await fixture.whenStable();
      TestBed.inject(HttpTestingController)
        .expectOne('/api/household-ratio')
        .flush({ entries: ratio });
    }
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
    expect(page.querySelector('[data-status-pill]')?.textContent?.trim()).toBe('Reserverad');
    expect(page.querySelector('[data-pending-note]')?.textContent).toContain(
      'banken har inte bokfört köpet än',
    );
    expect(page.querySelector('[data-amount]')?.classList).toContain('text-pending');
    expect(field('paidBy')).toBe('Jag');
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
    const { page } = await render(details());

    expect(page.querySelector('[data-status-pill]')?.textContent?.trim()).toBe('Bokförd');
    expect(page.querySelector('[data-pending-note]')).toBeNull();
    expect(page.querySelector('[data-share-pill]')).toBeNull();
    expect(page.querySelector('[data-manual-pill]')).toBeNull();
    const shown = Array.from(page.querySelectorAll('[data-field]')).map((d) =>
      d.getAttribute('data-field'),
    );
    expect(shown).toEqual(['bank', 'account', 'paidBy']);
  });

  describe('share', () => {
    const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();
    const shareText = (page: HTMLElement, key: string) =>
      text(page.querySelector(`[data-share-${key}]`));

    it('shows the effective share, where it comes from and the owner’s part in kr', async () => {
      const { page } = await render(
        details({
          amount: { amount: -250, currency: 'SEK' },
          share: { option: 'half', percent: 50, source: 'account' },
          ownerPart: -125,
        }),
      );

      expect(shareText(page, 'name')).toBe('50/50');
      expect(shareText(page, 'source')).toBe('Från kontot');
      expect(shareText(page, 'part')).toMatch(/^−125,00\skr$/);
      expect(shareText(page, 'partner-part')).toMatch(/^−125,00\skr$/);
      expect(page.querySelector<HTMLElement>('[data-share-bar]')?.style.width).toBe('50%');
      expect(text(page.querySelector('[data-share-pill]'))).toBe('Delad · 50/50');
    });

    it('names the household ratio and the other sources', async () => {
      const household = details({ share: { option: 'household', percent: 60, source: 'default' } });
      expect(shareText((await render(household)).page, 'name')).toBe('Hushåll (60/40)');
    });

    it.each([
      [
        'subcategory',
        'Från underkategorin',
        {
          category: {
            category: { id: 2, name: 'Mat & Dryck', colour: 'green' },
            subcategory: { id: 12, name: 'Livsmedel', icon: 'shopping-basket' },
            confirmed: true,
          } as TransactionCategory,
        },
      ],
      ['transaction', 'Egen andel', {}],
    ] as const)('says a share from the %s is %s', async (source, expected, extra) => {
      const { page } = await render(
        details({ ...extra, share: { option: 'partner', percent: 0, source } }),
      );
      expect(shareText(page, 'source')).toBe(expected);
    });

    async function openChoices(response: TransactionDetails) {
      const rendered = await render(response);
      return { ...rendered, http: TestBed.inject(HttpTestingController) };
    }

    const optionButtons = (page: HTMLElement) =>
      Array.from(page.querySelectorAll<HTMLButtonElement>('[data-share-option]'));

    it('offers the four options, marking the current one', async () => {
      const { page } = await openChoices(
        details({ share: { option: 'half', percent: 50, source: 'account' } }),
      );

      expect(optionButtons(page).map((b) => [b.dataset['shareOption'], text(b)])).toEqual([
        ['me', 'Jag'],
        ['half', '50/50'],
        ['household', 'Hushåll'],
        ['partner', 'Partner'],
      ]);
      expect(optionButtons(page).map((b) => b.getAttribute('aria-pressed'))).toEqual([
        'false',
        'true',
        'false',
        'false',
      ]);
    });

    it('sets the chosen option and shows the new share', async () => {
      const { page, fixture, http } = await openChoices(details());
      const service = TestBed.inject(TransactionsService);
      service.listed = { key: '', transactions: [], cursor: null, count: 0, sum: null };

      optionButtons(page)[3]!.click();
      const put = http.expectOne('/api/transactions/5/share');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ share: 'partner' });
      put.flush(details({ share: { option: 'partner', percent: 0, source: 'transaction' } }));
      await fixture.whenStable();

      expect(shareText(page, 'name')).toBe('Partner');
      expect(shareText(page, 'source')).toBe('Egen andel');
      expect(TestBed.inject(ToastService).message()).toBe('Andelen sparades');
      expect(service.listed).toBeNull();
    });

    it('removes the own share to go back to the inherited one', async () => {
      const { page, fixture } = await render(
        details({ share: { option: 'partner', percent: 0, source: 'transaction' } }),
      );
      const http = TestBed.inject(HttpTestingController);

      (page.querySelector('[data-remove-share]') as HTMLButtonElement).click();
      const put = http.expectOne('/api/transactions/5/share');
      expect(put.request.body).toEqual({ share: null });
      put.flush(details({ share: { option: 'half', percent: 50, source: 'account' } }));
      await fixture.whenStable();

      expect(shareText(page, 'name')).toBe('50/50');
      expect(page.querySelector('[data-remove-share]')).toBeNull();
    });

    it('offers no removal while the share is inherited', async () => {
      const { page } = await render(details());
      expect(page.querySelector('[data-remove-share]')).toBeNull();
    });

    it('disables Hushåll while there is no household ratio', async () => {
      const rendered = await render(details(), []);

      const household = optionButtons(rendered.page).find(
        (b) => b.dataset['shareOption'] === 'household',
      );
      expect(household?.disabled).toBe(true);
    });

    it('shows an error when saving fails', async () => {
      const { page, fixture, http } = await openChoices(details());
      optionButtons(page)[1]!.click();
      http
        .expectOne('/api/transactions/5/share')
        .flush('', { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();

      expect(page.querySelector('[data-share-error]')?.textContent).toContain('kunde inte sparas');
      expect(shareText(page, 'name')).toBe('Jag');
    });

    it('is locked on an offset refund, which links to its purchase', async () => {
      const { page } = await render(
        details({
          amount: { amount: 50, currency: 'SEK' },
          share: { option: 'half', percent: 50, source: 'purchase' },
          offsets: {
            id: 3,
            description: 'Kläder',
            amount: { amount: -200, currency: 'SEK' },
            date: '2026-11-01',
          } as TransactionDetails['offsets'],
        }),
      );

      expect(shareText(page, 'source')).toBe('Följer köpet');
      expect(page.querySelector('[data-share-purchase]')?.getAttribute('href')).toBe(
        '/transaktioner/3',
      );
      expect(optionButtons(page)).toHaveLength(0);
      expect(page.querySelector('[data-remove-share]')).toBeNull();
    });
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
        key: '',
        transactions: [{ ...details(), date: '2026-11-08', category: guess }],
        cursor: null,
        count: 1,
        sum: null,
      };
      const rendered = await render(details({ category: guess }));
      const { page } = rendered;

      expect(page.querySelector('[data-category] [data-guessed]')).not.toBeNull();
      expect(page.querySelector('[data-category-guessed-note]')?.textContent?.trim()).toBe(
        'Gissad',
      );
      expect(page.querySelector('[data-guess-bar]')?.textContent).toContain('Stämmer gissningen?');

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
      expect(TestBed.inject(ToastService).message()).toBe('Kategorin bekräftades');
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

    const tileNames = (page: HTMLElement) =>
      Array.from(page.querySelectorAll('[data-picker-category]')).map((tile) =>
        tile.querySelector('[data-picker-category-name]')?.textContent?.trim(),
      );
    const chips = (page: HTMLElement) =>
      Array.from(page.querySelectorAll('[data-subcategory]')).map((c) => c.textContent?.trim());

    it('opens a picker with a tile per category in order, then the subcategories of the chosen one', async () => {
      const rendered = await render(details());
      expect(rendered.page.querySelector('[data-picker]')).toBeNull();

      await openPicker(rendered);
      expect(tileNames(rendered.page)).toEqual(['Mat & Dryck', 'Transport']);
      expect(chips(rendered.page)).toEqual([]);

      (rendered.page.querySelector('[data-category-tile="3"]') as HTMLButtonElement).click();
      await rendered.fixture.whenStable();
      expect(chips(rendered.page)).toEqual(['Kollektivtrafik', 'Taxi']);
    });

    it('opens on the current category', async () => {
      const rendered = await render(details({ category: livsmedel }));
      await openPicker(rendered);

      expect(chips(rendered.page)).toEqual(['Livsmedel', 'Restaurang', 'Övrigt']);
    });

    it('saves the chosen subcategory as confirmed and shows it, also in the list kept for the way back', async () => {
      const service = TestBed.inject(TransactionsService);
      const listed = { ...details(), date: '2026-11-08', category: livsmedel };
      service.listed = { key: '', transactions: [listed], cursor: null, count: 1, sum: null };
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
      expect(TestBed.inject(ToastService).message()).toBe('Kategorin sparades');
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
      expect(TestBed.inject(ToastService).message()).toBe('Kategorin togs bort');
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

  describe('kvittning', () => {
    const purchase = {
      id: 3,
      description: 'Zalando',
      amount: { amount: -500, currency: 'SEK' },
      date: '2026-11-10',
    };
    const refund = {
      id: 8,
      description: 'Zalando retur',
      amount: { amount: 200, currency: 'SEK' },
      date: '2026-12-05',
    };

    it('shows a purchase’s refunds and its net amount', async () => {
      const { page } = await render(
        details({ refunds: [refund], netAmount: { amount: -300, currency: 'SEK' } }),
      );

      expect(page.querySelector('[data-refund="8"]')?.getAttribute('href')).toBe(
        '/transaktioner/8',
      );
      expect(page.querySelector('[data-net-amount]')?.textContent?.trim()).toMatch(/^−300,00\skr$/);
      expect(page.querySelector('[data-offset-picker]')).toBeNull();
    });

    it('shows the purchase a refund is offset against, without a way to change its category', async () => {
      const { page } = await render(details({ amount: refund.amount, offsets: purchase }));

      expect(page.querySelector('[data-offsets-purchase]')?.getAttribute('href')).toBe(
        '/transaktioner/3',
      );
      expect(page.querySelector('[data-category-button]')).toBeNull();
      expect(page.querySelector('[data-remove-category]')).toBeNull();
    });

    it('offers suggestions on a money-in transaction and links the chosen purchase', async () => {
      const service = TestBed.inject(TransactionsService);
      service.listed = { key: '', transactions: [], cursor: null, count: 0, sum: null };
      const rendered = await render(details({ amount: refund.amount }));
      const http = TestBed.inject(HttpTestingController);

      (rendered.page.querySelector('[data-offset-toggle]') as HTMLButtonElement).click();
      await rendered.fixture.whenStable();
      http.expectOne('/api/transactions/5/offset-candidates').flush({
        transactions: [{ ...details(), id: 3, description: 'Zalando', date: '2026-11-10' }],
      });
      await rendered.fixture.whenStable();

      (rendered.page.querySelector('[data-offset-candidate="3"]') as HTMLButtonElement).click();
      const put = http.expectOne('/api/transactions/5/offset');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ purchaseId: 3 });
      put.flush(details({ amount: refund.amount, offsets: purchase }));
      http.expectOne('/api/transactions/review/count').flush({ count: 0 });
      await rendered.fixture.whenStable();

      expect(rendered.page.querySelector('[data-offsets-purchase]')).not.toBeNull();
      expect(TestBed.inject(ToastService).message()).toBe('Kvittningen sparades');
      expect(service.listed).toBeNull();
    });

    it('searches for any purchase', async () => {
      const rendered = await render(details({ amount: refund.amount }));
      const http = TestBed.inject(HttpTestingController);
      (rendered.page.querySelector('[data-offset-toggle]') as HTMLButtonElement).click();
      await rendered.fixture.whenStable();
      http.expectOne('/api/transactions/5/offset-candidates').flush({ transactions: [] });
      await rendered.fixture.whenStable();

      const input = rendered.page.querySelector('[data-offset-search]') as HTMLInputElement;
      input.value = 'zal';
      input.dispatchEvent(new Event('input'));
      await rendered.fixture.whenStable();

      http
        .expectOne(
          (r) => r.url === '/api/transactions/5/offset-candidates' && r.params.get('q') === 'zal',
        )
        .flush({ transactions: [] });
      await rendered.fixture.whenStable();
      expect(rendered.page.querySelector('[data-offset-empty]')?.textContent?.trim()).toBe(
        'Inga träffar',
      );
    });

    it('removes a link', async () => {
      const rendered = await render(details({ amount: refund.amount, offsets: purchase }));
      const http = TestBed.inject(HttpTestingController);

      (rendered.page.querySelector('[data-remove-offset]') as HTMLButtonElement).click();
      const put = http.expectOne('/api/transactions/5/offset');
      expect(put.request.body).toEqual({ purchaseId: null });
      put.flush(details({ amount: refund.amount }));
      http.expectOne('/api/transactions/review/count').flush({ count: 0 });
      await rendered.fixture.whenStable();

      expect(rendered.page.querySelector('[data-offsets]')).toBeNull();
      expect(rendered.page.querySelector('[data-offset-picker]')).not.toBeNull();
      expect(TestBed.inject(ToastService).message()).toBe('Kvittningen togs bort');
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

  describe('a manual transaction', () => {
    it('shows Manuell as its account, with edit and a confirmed delete, and no raw data', async () => {
      const { fixture, page, field } = await render(details({ account: null, raw: '{}' }));
      const http = TestBed.inject(HttpTestingController);

      expect(field('account')).toBe('Manuell');
      expect(page.querySelector('[data-manual-pill]')?.textContent?.trim()).toBe('Manuell');
      expect(field('bank')).toBeNull();
      expect(page.querySelector('[data-raw]')).toBeNull();
      expect(page.querySelector('[data-edit]')?.getAttribute('href')).toBe(
        '/transaktioner/5/redigera',
      );

      (page.querySelector('[data-delete]') as HTMLButtonElement).click();
      await fixture.whenStable();
      http.expectNone('/api/transactions/5');
      expect(page.querySelector('[data-confirm-delete]')).not.toBeNull();
    });

    it('is deleted once confirmed', async () => {
      const { fixture, page } = await render(details({ account: null }));
      const http = TestBed.inject(HttpTestingController);

      (page.querySelector('[data-delete]') as HTMLButtonElement).click();
      await fixture.whenStable();
      (page.querySelector('[data-confirm-delete]') as HTMLButtonElement).click();
      const request = http.expectOne('/api/transactions/5');
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });
      expect(TestBed.inject(ToastService).message()).toBe('Transaktionen togs bort');
    });

    it('offers neither for a bank transaction', async () => {
      const { page } = await render(details());

      expect(page.querySelector('[data-manual-actions]')).toBeNull();
    });
  });
});
