import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  CATEGORY_PALETTE,
  type Category,
  type Transaction,
  type TransactionsResponse,
} from '@bankapp/shared';
import { LUCIDE_ICONS } from '../../category-icon/lucide-icons';
import { TransactionsService } from '../../transactions.service';
import { TransactionsPage } from './transactions.page';

describe('TransactionsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TransactionsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

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

  const response = (
    transactions: Transaction[],
    nextCursor: string | null = null,
  ): TransactionsResponse => ({
    transactions,
    nextCursor,
    count: transactions.length,
    sum: null,
  });

  async function render(body: TransactionsResponse | 'error') {
    const fixture = TestBed.createComponent(TransactionsPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne((r) => r.url === '/api/transactions');
    expect(request.request.params.has('before')).toBe(false);
    if (body === 'error') request.error(new ProgressEvent('error'));
    else request.flush(body);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement, http };
  }

  const rows = (page: HTMLElement) =>
    Array.from(page.querySelectorAll('li[data-transaction]')).map((li) => ({
      text: li.querySelector('[data-description]')?.textContent?.trim(),
      amount: li.querySelector('[data-amount]')?.textContent?.trim(),
    }));

  it('shows transactions grouped under Swedish date headings', async () => {
    const { page } = await render(
      response([
        transaction(3, { date: '2026-11-10' }),
        transaction(2, { date: '2026-11-09' }),
        transaction(1, { date: '2026-11-09' }),
      ]),
    );

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Transaktioner');
    const groups = Array.from(page.querySelectorAll('section[data-date]')).map((group) => ({
      heading: group.querySelector('h2 > span')?.textContent?.trim(),
      descriptions: Array.from(group.querySelectorAll('[data-description]')).map((d) =>
        d.textContent?.trim(),
      ),
    }));
    expect(groups).toEqual([
      { heading: 'Tisdag 10 november 2026', descriptions: ['Köp 3'] },
      { heading: 'Måndag 9 november 2026', descriptions: ['Köp 2', 'Köp 1'] },
    ]);
  });

  it('shows amounts in Swedish format, with incoming money in green', async () => {
    const { page } = await render(
      response([
        transaction(2, { amount: { amount: 1500, currency: 'SEK' } }),
        transaction(1, { amount: { amount: -1234.5, currency: 'SEK' } }),
      ]),
    );

    const [incoming, outgoing] = Array.from(page.querySelectorAll('[data-amount]'));
    expect(incoming?.textContent?.trim()).toBe('1 500,00 kr');
    expect(incoming?.classList.contains('text-positive')).toBe(true);
    expect(outgoing?.textContent?.trim()).toBe('−1 234,50 kr');
    expect(outgoing?.classList.contains('text-positive')).toBe(false);
  });

  it('shows the subcategory icon on the category colour, and a placeholder when uncategorised', async () => {
    const { page } = await render(
      response([
        transaction(2, {
          category: {
            category: { id: 2, name: 'Mat & Dryck', colour: 'green' },
            subcategory: { id: 12, name: 'Livsmedel', icon: 'shopping-basket' },
            confirmed: true,
          },
        }),
        transaction(1),
      ]),
    );

    const [categorised, uncategorised] = Array.from(page.querySelectorAll('li[data-transaction]'));
    const badge = categorised?.querySelector('[data-badge]') as HTMLElement;
    expect(badge.getAttribute('aria-label')).toBe('Livsmedel');
    expect(badge.style.getPropertyValue('--category-colour')).toBe(CATEGORY_PALETTE.green.colour);
    expect(badge.querySelector('path')?.getAttribute('d')).toBe(
      LUCIDE_ICONS['shopping-basket'].find(([tag]) => tag === 'path')?.[1]['d'],
    );
    expect(uncategorised?.querySelector('[data-badge]')).toBeNull();
    expect(uncategorised?.querySelector('[data-uncategorised]')?.getAttribute('aria-label')).toBe(
      'Okategoriserad',
    );
  });

  it('shows a guessed category dimmed, and a confirmed one not', async () => {
    const category = (confirmed: boolean) => ({
      category: { id: 2, name: 'Mat & Dryck', colour: 'green' as const },
      subcategory: { id: 12, name: 'Livsmedel', icon: 'shopping-basket' as const },
      confirmed,
    });
    const { page } = await render(
      response([
        transaction(2, { category: category(false) }),
        transaction(1, { category: category(true) }),
      ]),
    );

    const [guessed, confirmed] = Array.from(page.querySelectorAll('li[data-transaction]'));
    expect(guessed?.querySelector('[data-guessed]')).not.toBeNull();
    expect(guessed?.querySelector('[data-badge]')?.getAttribute('aria-label')).toBe(
      'Livsmedel (gissad)',
    );
    expect(confirmed?.querySelector('[data-guessed]')).toBeNull();
  });

  it('marks shared transactions with a badge, and leaves Jag ones without', async () => {
    const { page } = await render(
      response([
        transaction(1, { share: { option: 'half', percent: 50, source: 'account' } }),
        transaction(2, { share: { option: 'household', percent: 60, source: 'subcategory' } }),
        transaction(3, { share: { option: 'partner', percent: 0, source: 'transaction' } }),
        transaction(4),
      ]),
    );

    const badges = Array.from(page.querySelectorAll('li[data-transaction]')).map((li) =>
      li.querySelector('[data-share-badge]')?.textContent?.trim(),
    );
    expect(badges).toEqual(['50/50', 'Hushåll', 'Partner', undefined]);
    expect(page.querySelector('[data-own-share]')).toBeNull();
  });

  it('links each transaction to its page', async () => {
    const { page } = await render(response([transaction(3), transaction(2)]));

    const links = Array.from(page.querySelectorAll('li[data-transaction] a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/transaktioner/3',
      '/transaktioner/2',
    ]);
  });

  it('shows the list as it was left, without fetching, when coming back with the back button', async () => {
    const service = TestBed.inject(TransactionsService);
    service.listed = {
      key: '',
      transactions: [transaction(9)],
      cursor: '2026-11-10:9',
      count: 1,
      sum: null,
    };
    vi.spyOn(TestBed.inject(Router), 'currentNavigation').mockReturnValue({
      trigger: 'popstate',
    } as ReturnType<Router['currentNavigation']>);

    const fixture = TestBed.createComponent(TransactionsPage);
    await fixture.whenStable();
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    expect(rows(page).map((row) => row.text)).toEqual(['Köp 9']);
    expect(page.querySelector('[data-more]')).not.toBeNull();
  });

  it('remembers what it loaded for the way back', async () => {
    await render(response([transaction(1)], '2026-11-10:1'));

    expect(TestBed.inject(TransactionsService).listed).toEqual({
      key: '',
      transactions: [transaction(1)],
      cursor: '2026-11-10:1',
      count: 1,
      sum: null,
    });
  });

  it('marks pending transactions as Reserverad and no others', async () => {
    const { page } = await render(
      response([transaction(2, { status: 'pending' }), transaction(1)]),
    );

    const [pending, booked] = Array.from(page.querySelectorAll('li[data-transaction]'));
    expect(pending?.textContent).toContain('Reserverad');
    expect(booked?.textContent).not.toContain('Reserverad');
  });

  it('names the account of each transaction', async () => {
    const { page } = await render(
      response([
        transaction(2, {
          account: { id: 8, name: 'Sparkonto', bank: 'Skandia', type: 'savings' },
        }),
        transaction(1),
      ]),
    );

    expect(
      Array.from(page.querySelectorAll('[data-account]')).map((a) => a.textContent?.trim()),
    ).toEqual(['Sparkonto', 'Lönekonto']);
  });

  it('says so when there are no transactions yet', async () => {
    const { page } = await render(response([]));

    expect(page.textContent).toContain('Inga transaktioner');
  });

  it('shows an error when the transactions cannot be fetched', async () => {
    const { page } = await render('error');

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
  });

  describe('a long history', () => {
    it('loads the next page on request, continuing a day already shown, until there are no more', async () => {
      const { fixture, page, http } = await render(
        response([transaction(3, { date: '2026-11-10' }), transaction(2)], '2026-11-10:2'),
      );
      expect(rows(page)).toHaveLength(2);

      (page.querySelector('button[data-more]') as HTMLButtonElement).click();
      const next = http.expectOne(
        (r) => r.url === '/api/transactions' && r.params.get('before') === '2026-11-10:2',
      );
      next.flush(response([transaction(1, { date: '2026-11-10' })]));
      await fixture.whenStable();

      expect(rows(page).map((row) => row.text)).toEqual(['Köp 3', 'Köp 2', 'Köp 1']);
      expect(page.querySelectorAll('section[data-date]')).toHaveLength(1);
      expect(page.querySelector('button[data-more]')).toBeNull();
    });

    it('keeps what is shown and offers a retry when the next page fails', async () => {
      const { fixture, page, http } = await render(response([transaction(1)], '2026-11-10:1'));

      (page.querySelector('button[data-more]') as HTMLButtonElement).click();
      http
        .expectOne((r) => r.params.get('before') === '2026-11-10:1')
        .error(new ProgressEvent('error'));
      await fixture.whenStable();

      expect(rows(page)).toHaveLength(1);
      expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
      expect(page.querySelector('button[data-more]')).not.toBeNull();
    });
  });

  it('shows Manuell where a manual transaction’s account would be and links to adding one', async () => {
    const { page } = await render(response([transaction(1, { account: null })]));

    expect(page.querySelector('[data-account]')?.textContent?.trim()).toBe('Manuell');
    expect(page.querySelector('[data-add]')?.getAttribute('href')).toBe('/transaktioner/ny');
  });

  describe('rows', () => {
    const guessed = (overrides: Partial<Transaction> = {}) =>
      transaction(1, {
        category: {
          category: { id: 1, name: 'Nöje', colour: 'violet' },
          subcategory: {
            id: 5,
            name: 'Streaming & prenumerationer',
            icon: 'tv',
            sortOrder: 1,
            share: null,
          },
          confirmed: false,
        },
        ...overrides,
      } as Partial<Transaction>);

    it('shows the day’s sum beside its heading', async () => {
      const { page } = await render(
        response([
          transaction(3, { amount: { amount: -100.5, currency: 'SEK' }, date: '2026-11-10' }),
          transaction(2, { amount: { amount: 20, currency: 'SEK' }, date: '2026-11-10' }),
          transaction(1, { amount: { amount: -5, currency: 'EUR' }, date: '2026-11-09' }),
          transaction(0, { amount: { amount: -5, currency: 'SEK' }, date: '2026-11-09' }),
        ]),
      );

      const sums = Array.from(page.querySelectorAll('section[data-date]')).map((section) =>
        section.querySelector('[data-day-sum]')?.textContent?.trim().replace(/\s/g, ' '),
      );
      expect(sums).toEqual(['−80,50 kr', undefined]); // a day mixing currencies has no sum
    });

    it('shows the subcategory in full, in its category colour, and the description', async () => {
      const { page } = await render(
        response([guessed({ description: 'Systembolaget Sveavägen' })]),
      );

      const sub = page.querySelector('[data-subcategory]') as HTMLElement;
      expect(sub.textContent?.trim()).toBe('Streaming & prenumerationer');
      expect(sub.classList.contains('truncate')).toBe(false);
      expect(sub.style.color).not.toBe('');
      expect(page.querySelector('[data-description]')?.textContent?.trim()).toBe(
        'Systembolaget Sveavägen',
      );
    });

    it('says Okategoriserad in muted italic when there is no category', async () => {
      const { page } = await render(response([transaction(1)]));

      const sub = page.querySelector('[data-subcategory]') as HTMLElement;
      expect(sub.textContent?.trim()).toBe('Okategoriserad');
      expect(sub.classList.contains('italic')).toBe(true);
    });

    it('keeps Reserverad, 50/50 and Gissad on one line, in that fixed group', async () => {
      const { page } = await render(
        response([
          guessed({
            status: 'pending',
            share: { option: 'half', percent: 50, source: 'transaction' },
          }),
        ]),
      );

      const pills = page.querySelector('[data-pills]') as HTMLElement;
      expect(Array.from(pills.children).map((c) => c.textContent?.trim())).toEqual([
        '50/50',
        'Gissad',
        'Reserverad',
      ]);
      expect(pills.classList.contains('flex-nowrap')).toBe(true);
      expect(pills.classList.contains('shrink-0')).toBe(true);
    });

    it('makes a pending transaction recognisable: light-blue amount, dashed ring and pill', async () => {
      const { page } = await render(
        response([
          transaction(2, { status: 'pending', amount: { amount: 50, currency: 'SEK' } }),
          transaction(1),
        ]),
      );

      const [pending, booked] = Array.from(page.querySelectorAll('li[data-transaction]'));
      expect(pending.querySelector('[data-amount]')?.classList.contains('text-pending')).toBe(true);
      // Pending wins over the positive colour.
      expect(pending.querySelector('[data-amount]')?.classList.contains('text-positive')).toBe(
        false,
      );
      expect(pending.querySelector('[data-pending]')).not.toBeNull();
      expect(pending.querySelector('.pill-pending')?.textContent?.trim()).toBe('Reserverad');
      expect(booked.querySelector('[data-amount]')?.classList.contains('text-pending')).toBe(false);
      expect(booked.querySelector('[data-pending]')).toBeNull();
      expect(booked.querySelector('.pill-pending')).toBeNull();
    });

    it('says who paid a manual transaction', async () => {
      const { page } = await render(
        response([
          transaction(2, { account: null, paidBy: 'partner' }),
          transaction(1, { account: null }),
        ]),
      );

      expect(
        Array.from(page.querySelectorAll('[data-account]')).map((a) => a.textContent?.trim()),
      ).toEqual(['Manuell · Partner', 'Manuell']);
    });
  });
  describe('search and filters', () => {
    const lookups = (
      http: HttpTestingController,
      accounts: { id: number; name: string; hidden?: boolean }[] = [],
      categories: Partial<Category>[] = [],
    ) => {
      http.expectOne('/api/accounts').flush({
        banks: [
          {
            bank: 'Swedbank',
            status: 'active',
            validUntil: '2027-01-01T00:00:00Z',
            accounts: accounts.map((a) => ({ hidden: false, ...a })),
            closedAccounts: [],
          },
        ],
        syncing: null,
        lastSync: null,
      });
      http.expectOne('/api/categories').flush({ categories });
    };

    const food: Partial<Category> = {
      id: 4,
      name: 'Mat & Dryck',
      colour: 'green',
      icon: 'shopping-basket',
      subcategories: [],
    };

    const listRequest = (http: HttpTestingController) =>
      http.expectOne((r) => r.url === '/api/transactions');

    async function visit(query: Record<string, string>, body = response([transaction(1)])) {
      await TestBed.inject(Router).navigate([], { queryParams: query });
      const fixture = TestBed.createComponent(TransactionsPage);
      await fixture.whenStable();
      const http = TestBed.inject(HttpTestingController);
      return { fixture, http, page: fixture.nativeElement as HTMLElement, body };
    }

    it('sends the filters in the URL to the server', async () => {
      const { fixture, http, body } = await visit({
        q: 'ica',
        from: '2026-11-01',
        to: '2026-11-30',
        accounts: '3,manual',
        categories: '4,none',
        kind: 'out',
        min: '100',
        max: '500',
      });
      const request = listRequest(http);
      expect(
        Object.fromEntries(
          request.request.params.keys().map((k) => [k, request.request.params.get(k)]),
        ),
      ).toEqual({
        q: 'ica',
        from: '2026-11-01',
        to: '2026-11-30',
        accounts: '3,manual',
        categories: '4,none',
        kind: 'out',
        min: '100',
        max: '500',
      });
      request.flush(body);
      lookups(http, [{ id: 3, name: 'Coop Mastercard' }], [food]);
      await fixture.whenStable();
    });

    it('shows each active filter as a removable chip, and a count on the Filter button', async () => {
      const { fixture, http, page } = await visit({
        accounts: '3',
        categories: '4',
        kind: 'out',
        min: '100',
        max: '500',
      });
      listRequest(http).flush(response([transaction(1)]));
      lookups(http, [{ id: 3, name: 'Coop Mastercard' }], [food]);
      await fixture.whenStable();

      const chips = Array.from(page.querySelectorAll('[data-active-chip]'));
      expect(chips.map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        'Utgifter ✕',
        '100–500 kr ✕',
        'Coop Mastercard ✕',
        'Mat & Dryck ✕',
      ]);
      expect((chips[3]?.querySelector('[data-dot]') as HTMLElement).style.background).not.toBe('');
      expect(page.querySelector('[data-filter-count]')?.textContent?.trim()).toBe('4');

      (chips[0] as HTMLButtonElement).click();
      await fixture.whenStable();
      const again = listRequest(http);
      expect(again.request.params.has('kind')).toBe(false);
      expect(again.request.params.get('categories')).toBe('4');
      again.flush(response([transaction(1)]));
      await fixture.whenStable();
      expect(page.querySelector('[data-filter-count]')?.textContent?.trim()).toBe('3');
    });

    it('shows how many transactions match and what they add up to', async () => {
      const { fixture, http, page } = await visit({ kind: 'out' });
      listRequest(http).flush({
        transactions: [transaction(1)],
        nextCursor: null,
        count: 18,
        sum: { amount: -13274, currency: 'SEK' },
      });
      await fixture.whenStable();

      expect(page.querySelector('[data-result]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        '18 transaktioner · −13 274,00 kr',
      );
    });

    it('says so when nothing matches, and clears the filters', async () => {
      const { fixture, http, page } = await visit({ q: 'xyz' });
      listRequest(http).flush(response([]));
      await fixture.whenStable();

      expect(page.querySelector('[data-no-results]')?.textContent).toContain('Inga transaktioner');
      (page.querySelector('[data-clear-filters]') as HTMLButtonElement).click();
      await fixture.whenStable();

      const all = listRequest(http);
      expect(all.request.params.keys()).toEqual([]);
      all.flush(response([transaction(1)]));
      await fixture.whenStable();
      expect(page.querySelector('[data-no-results]')).toBeNull();
    });

    it('searches after a pause in typing, and keeps the search in the URL', async () => {
      const { fixture, http, page } = await visit({});
      listRequest(http).flush(response([transaction(1)]));
      await fixture.whenStable();
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const input = page.querySelector('[data-search]') as HTMLInputElement;
      input.value = 'i';
      input.dispatchEvent(new Event('input'));
      await pause(100);
      input.value = 'ica';
      input.dispatchEvent(new Event('input'));
      await pause(100);
      http.expectNone('/api/transactions');
      await pause(250);
      await fixture.whenStable();

      const request = listRequest(http);
      expect(request.request.params.get('q')).toBe('ica');
      request.flush(response([transaction(1)]));
      expect(TestBed.inject(Router).url).toBe('/?q=ica');
      await fixture.whenStable();

      (page.querySelector('[data-clear-search]') as HTMLButtonElement).click();
      await fixture.whenStable();
      listRequest(http).flush(response([transaction(1)]));
      expect(TestBed.inject(Router).url).toBe('/');
    });

    it('offers the quick periods', async () => {
      const { fixture, http, page } = await visit({});
      listRequest(http).flush(response([transaction(1)]));
      await fixture.whenStable();

      expect(
        Array.from(page.querySelectorAll('[data-period]')).map((c) => c.textContent?.trim()),
      ).toEqual([
        'Alla datum',
        'Senaste 7 dagarna',
        new Intl.DateTimeFormat('sv-SE', { month: 'long' })
          .format(new Date())
          .replace(/^./, (c) => c.toUpperCase()),
        'Välj datum',
      ]);

      (page.querySelector('[data-period="last7"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      const request = listRequest(http);
      expect(request.request.params.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(request.request.params.has('to')).toBe(false);
      request.flush(response([transaction(1)]));
    });

    it('opens a panel whose changes narrow the list', async () => {
      const { fixture, http, page } = await visit({});
      listRequest(http).flush(response([transaction(1)]));
      await fixture.whenStable();

      (page.querySelector('[data-filter-button]') as HTMLButtonElement).click();
      await fixture.whenStable();
      lookups(
        http,
        [
          { id: 3, name: 'Coop Mastercard' },
          { id: 5, name: 'Dolt', hidden: true },
        ],
        [food],
      );
      await fixture.whenStable();

      const panel = page.querySelector('[data-filter-panel]') as HTMLElement;
      expect(
        Array.from(panel.querySelectorAll('[data-section="konton"] label')).map((l) =>
          l.textContent?.trim(),
        ),
      ).toEqual(['Coop Mastercard', 'Manuell']);
      expect(panel.querySelector('[data-category="none"]')?.textContent).toContain(
        'Okategoriserad',
      );

      (panel.querySelector('[data-kind="out"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      listRequest(http).flush(response([transaction(1)]));
      (panel.querySelector('[data-account="3"]') as HTMLInputElement).click();
      await fixture.whenStable();
      listRequest(http).flush(response([transaction(1)]));
      (panel.querySelector('[data-category="4"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      listRequest(http).flush(response([transaction(1)]));
      (panel.querySelector('[data-amount-preset]:nth-of-type(2)') as HTMLButtonElement).click();
      await fixture.whenStable();

      const request = listRequest(http);
      expect(request.request.params.get('kind')).toBe('out');
      expect(request.request.params.get('accounts')).toBe('3');
      expect(request.request.params.get('categories')).toBe('4');
      expect(request.request.params.get('min')).toBe('100');
      expect(request.request.params.get('max')).toBe('500');
      request.flush({ transactions: [transaction(1)], nextCursor: null, count: 7, sum: null });
      await fixture.whenStable();

      expect(panel.querySelector('[data-show]')?.textContent?.trim()).toBe('Visa 7 transaktioner');
      (panel.querySelector('[data-show]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(page.querySelector('[data-filter-panel]')).toBeNull();
    });

    it('shows date inputs when Välj datum is picked in the panel', async () => {
      const { fixture, http, page } = await visit({});
      listRequest(http).flush(response([transaction(1)]));
      (page.querySelector('[data-filter-button]') as HTMLButtonElement).click();
      await fixture.whenStable();
      lookups(http);
      await fixture.whenStable();
      const panel = page.querySelector('[data-filter-panel]') as HTMLElement;
      expect(panel.querySelector('[data-from]')).toBeNull();

      (panel.querySelector('[data-period="custom"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      const from = panel.querySelector('[data-from]') as HTMLInputElement;
      from.value = '2026-11-01';
      from.dispatchEvent(new Event('change'));
      await fixture.whenStable();

      expect(listRequest(http).request.params.get('from')).toBe('2026-11-01');
    });

    it('pages with the filters', async () => {
      const { fixture, http, page } = await visit({ q: 'ica' });
      listRequest(http).flush(response([transaction(2)], '2026-11-10:2'));
      await fixture.whenStable();

      (page.querySelector('button[data-more]') as HTMLButtonElement).click();
      const next = http.expectOne((r) => r.params.get('before') === '2026-11-10:2');
      expect(next.request.params.get('q')).toBe('ica');
      next.flush(response([transaction(1)]));
      await fixture.whenStable();
    });

    it('only shows the list as it was left for the same filters', async () => {
      const service = TestBed.inject(TransactionsService);
      service.listed = {
        key: 'q=other',
        transactions: [transaction(9)],
        cursor: null,
        count: 1,
        sum: null,
      };
      vi.spyOn(TestBed.inject(Router), 'currentNavigation').mockReturnValue({
        trigger: 'popstate',
      } as ReturnType<Router['currentNavigation']>);
      const { fixture, http, page } = await visit({ q: 'ica' });

      listRequest(http).flush(response([transaction(1)]));
      await fixture.whenStable();
      expect(rows(page).map((row) => row.text)).toEqual(['Köp 1']);
    });

    it('links to the manual transaction form', async () => {
      const { fixture, http, page } = await visit({});
      listRequest(http).flush(response([]));
      await fixture.whenStable();

      expect(page.querySelector('[data-add]')?.getAttribute('href')).toBe('/transaktioner/ny');
    });
  });
});
