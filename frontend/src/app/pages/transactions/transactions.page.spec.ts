import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import {
  CATEGORY_PALETTE,
  type AccountsResponse,
  type Category,
  type Transaction,
  type TransactionsResponse,
} from '@bankapp/shared';
import { LUCIDE_ICONS } from '../../category-icon/lucide-icons';
import { CategoriesService } from '../../categories.service';
import { AccountsStore } from '../../stores/accounts.store';
import { FakeAccountsStore } from '../../stores/accounts.store.fake';
import { TransactionsStore } from '../../stores/transactions.store';
import { FakeTransactionsStore } from '../../stores/transactions.store.fake';
import { EMPTY_FILTERS } from './transaction-filters';
import { TransactionsPage } from './transactions.page';

describe('TransactionsPage', () => {
  let store: FakeTransactionsStore;
  let accountsStore: FakeAccountsStore;
  let categories: Partial<Category>[];

  beforeEach(() => {
    categories = [];
    store = new FakeTransactionsStore();
    accountsStore = new FakeAccountsStore();
    TestBed.configureTestingModule({
      imports: [TransactionsPage],
      providers: [
        provideRouter([]),
        { provide: TransactionsStore, useValue: store },
        { provide: AccountsStore, useValue: accountsStore },
        { provide: CategoriesService, useValue: { list: () => of(categories) } },
      ],
    });
  });

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

  /** Says what the store has loaded for the list. */
  function show(body: TransactionsResponse | 'error') {
    if (body === 'error') {
      store.listed.status.set('failed');
      return;
    }
    store.listed.transactions.set(body.transactions);
    store.listed.count.set(body.count);
    store.listed.sum.set(body.sum);
    store.listed.hasMore.set(body.nextCursor !== null);
    store.listed.status.set('ready');
  }

  /** What the page last asked the store for. */
  const lastRequest = () => store.listRequests.at(-1)!;

  async function render(body: TransactionsResponse | 'error') {
    show(body);
    const fixture = TestBed.createComponent(TransactionsPage);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement };
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

  it('asks the store to restore the list, not to load it afresh, when coming back with the back button', async () => {
    vi.spyOn(TestBed.inject(Router), 'currentNavigation').mockReturnValue({
      trigger: 'popstate',
    } as ReturnType<Router['currentNavigation']>);

    await render(response([transaction(9)], '2026-11-10:9'));

    expect(lastRequest()).toEqual({ filters: EMPTY_FILTERS, restore: true });
  });

  it('asks for the list afresh on any other visit', async () => {
    await render(response([transaction(1)]));

    expect(lastRequest()).toEqual({ filters: EMPTY_FILTERS, restore: false });
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
    it('offers the next page while there is one, and asks the store for it', async () => {
      const { fixture, page } = await render(
        response([transaction(3, { date: '2026-11-10' }), transaction(2)], '2026-11-10:2'),
      );

      (page.querySelector('button[data-more]') as HTMLButtonElement).click();
      expect(store.calls).toContainEqual({ method: 'loadMore', args: [] });

      store.listed.transactions.update((shown) => [
        ...shown,
        transaction(1, { date: '2026-11-10' }),
      ]);
      store.listed.hasMore.set(false);
      await fixture.whenStable();

      expect(rows(page).map((row) => row.text)).toEqual(['Köp 3', 'Köp 2', 'Köp 1']);
      expect(page.querySelectorAll('section[data-date]')).toHaveLength(1);
      expect(page.querySelector('button[data-more]')).toBeNull();
    });

    it('disables the button while the next page is on its way', async () => {
      const { fixture, page } = await render(response([transaction(1)], '2026-11-10:1'));
      store.listed.loadingMore.set(true);
      await fixture.whenStable();

      expect((page.querySelector('button[data-more]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('keeps what is shown and offers a retry when the next page fails', async () => {
      const { fixture, page } = await render(response([transaction(1)], '2026-11-10:1'));
      store.listed.moreFailed.set(true);
      await fixture.whenStable();

      expect(rows(page)).toHaveLength(1);
      expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
      expect(page.querySelector('button[data-more]')).not.toBeNull();
    });
  });

  it('lifts the page above the bottom tab bar (z-40 over z-30) while the manual transaction sheet is open', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        url: of([{ path: 'transaktioner' }, { path: 'ny' }]),
        snapshot: { queryParamMap: convertToParamMap({}) },
        queryParamMap: of(convertToParamMap({})),
      },
    });
    const { fixture } = await render(response([transaction(1)]));

    expect((fixture.nativeElement as HTMLElement).classList.contains('z-40')).toBe(true);

    // The sheet moves itself into <body>, where the test teardown would leave it behind.
    fixture.destroy();
    document.querySelectorAll('app-sheet').forEach((el) => el.remove());
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

    it('lets the pill group move under the account on phones, with no separator to strand', async () => {
      const { page } = await render(
        response([
          guessed({
            status: 'pending',
            share: { option: 'half', percent: 50, source: 'transaction' },
          }),
        ]),
      );

      const pills = page.querySelector('[data-pills]') as HTMLElement;
      const line = pills.parentElement as HTMLElement;
      expect(line.classList.contains('flex-wrap')).toBe(true);
      expect(line.textContent).not.toContain('·');
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
    const food: Partial<Category> = {
      id: 4,
      name: 'Mat & Dryck',
      colour: 'green',
      icon: 'shopping-basket',
      subcategories: [],
    };

    const accountsResponse = (
      accounts: { id: number; name: string; hidden?: boolean }[],
    ): AccountsResponse =>
      ({
        banks: [
          {
            bank: 'Swedbank',
            status: 'active',
            validUntil: '2027-01-01T00:00:00Z',
            accounts: accounts.map((a) => ({ hidden: false, ...a })),
            closedAccounts: [],
          },
        ],
        removedBanks: [],
        syncing: null,
        lastSync: null,
      }) as unknown as AccountsResponse;

    async function visit(query: Record<string, string>, body = response([transaction(1)])) {
      show(body);
      await TestBed.inject(Router).navigate([], { queryParams: query });
      const fixture = TestBed.createComponent(TransactionsPage);
      await fixture.whenStable();
      return { fixture, page: fixture.nativeElement as HTMLElement };
    }

    it('asks the store for the filters in the URL', async () => {
      await visit({
        q: 'ica',
        from: '2026-11-01',
        to: '2026-11-30',
        accounts: '3,manual',
        categories: '4,none',
        kind: 'out',
        min: '100',
        max: '500',
      });

      expect(lastRequest().filters).toEqual({
        ...EMPTY_FILTERS,
        q: 'ica',
        from: '2026-11-01',
        to: '2026-11-30',
        accounts: ['3', 'manual'],
        categories: ['4', 'none'],
        kind: 'out',
        min: '100',
        max: '500',
      });
    });

    it('shows each active filter as a removable chip, and a count on the Filter button', async () => {
      categories = [food];
      accountsStore.accounts.set(accountsResponse([{ id: 3, name: 'Coop Mastercard' }]));
      const { fixture, page } = await visit({
        accounts: '3',
        categories: '4',
        kind: 'out',
        min: '100',
        max: '500',
      });

      const chips = Array.from(page.querySelectorAll('[data-active-chip]'));
      expect(chips.map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        'Utgifter',
        '100–500 kr',
        'Coop Mastercard',
        'Mat & Dryck',
      ]);
      expect((chips[3]?.querySelector('[data-dot]') as HTMLElement).style.background).not.toBe('');
      expect(page.querySelector('[data-filter-count]')?.textContent?.trim()).toBe('4');

      (chips[0] as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(lastRequest().filters.kind).toBe('');
      expect(lastRequest().filters.categories).toEqual(['4']);
      expect(page.querySelector('[data-filter-count]')?.textContent?.trim()).toBe('3');
    });

    it('does not offer hidden or savings accounts as filters', async () => {
      accountsStore.accounts.set(
        accountsResponse([
          { id: 3, name: 'Coop Mastercard' },
          { id: 5, name: 'Dolt', hidden: true },
        ]),
      );
      const { fixture, page } = await visit({});

      (page.querySelector('[data-filter-button]') as HTMLButtonElement).click();
      await fixture.whenStable();

      const panel = document.querySelector('[data-filter-panel]') as HTMLElement;
      expect(
        Array.from(panel.querySelectorAll('[data-section="konton"] label')).map((l) =>
          l.textContent?.trim(),
        ),
      ).toEqual(['Coop Mastercard', 'Manuell']);
    });

    it('shows how many transactions match and what they add up to', async () => {
      const { page } = await visit(
        { kind: 'out' },
        {
          transactions: [transaction(1)],
          nextCursor: null,
          count: 18,
          sum: { amount: -13274, currency: 'SEK' },
        },
      );

      expect(page.querySelector('[data-result]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        '18 transaktioner · −13 274,00 kr',
      );
    });

    it('says so when nothing matches, and clears the filters', async () => {
      const { fixture, page } = await visit({ q: 'xyz' }, response([]));

      expect(page.querySelector('[data-no-results]')?.textContent).toContain('Inga transaktioner');
      (page.querySelector('[data-clear-filters]') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(lastRequest().filters).toEqual(EMPTY_FILTERS);
      show(response([transaction(1)]));
      await fixture.whenStable();
      expect(page.querySelector('[data-no-results]')).toBeNull();
    });

    it('searches after a pause in typing, and keeps the search in the URL', async () => {
      const { fixture, page } = await visit({});
      const asked = store.listRequests.length;
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const input = page.querySelector('[data-search]') as HTMLInputElement;
      input.value = 'i';
      input.dispatchEvent(new Event('input'));
      await pause(100);
      input.value = 'ica';
      input.dispatchEvent(new Event('input'));
      await pause(100);
      expect(store.listRequests).toHaveLength(asked);
      await pause(250);
      await fixture.whenStable();

      expect(lastRequest().filters.q).toBe('ica');
      expect(TestBed.inject(Router).url).toBe('/?q=ica');

      (page.querySelector('[data-clear-search]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(lastRequest().filters.q).toBe('');
      expect(TestBed.inject(Router).url).toBe('/');
    });

    it('offers the quick periods', async () => {
      const { fixture, page } = await visit({});

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
      expect(lastRequest().filters.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(lastRequest().filters.to).toBe('');
    });

    it('lifts the page above the bottom tab bar (z-40 over z-30) while the filter panel is open', async () => {
      const { fixture, page } = await visit({});
      const raised = () => (fixture.nativeElement as HTMLElement).classList.contains('z-40');
      expect(raised()).toBe(false);

      (page.querySelector('[data-filter-button]') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(raised()).toBe(true);
    });

    it('opens a panel whose changes narrow the list', async () => {
      categories = [food];
      accountsStore.accounts.set(accountsResponse([{ id: 3, name: 'Coop Mastercard' }]));
      const { fixture, page } = await visit({});

      (page.querySelector('[data-filter-button]') as HTMLButtonElement).click();
      await fixture.whenStable();

      const panel = document.querySelector('[data-filter-panel]') as HTMLElement;
      expect(panel.querySelector('[data-category="none"]')?.textContent).toContain(
        'Okategoriserad',
      );

      (panel.querySelector('[data-kind="out"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      (panel.querySelector('[data-account="3"]') as HTMLInputElement).click();
      await fixture.whenStable();
      (panel.querySelector('[data-category="4"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      (panel.querySelector('[data-amount-preset]:nth-of-type(2)') as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(lastRequest().filters).toMatchObject({
        kind: 'out',
        accounts: ['3'],
        categories: ['4'],
        min: '100',
        max: '500',
      });
      show({ transactions: [transaction(1)], nextCursor: null, count: 7, sum: null });
      await fixture.whenStable();

      expect(panel.querySelector('[data-show]')?.textContent?.trim()).toBe('Visa 7 transaktioner');
      (panel.querySelector('[data-show]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(document.querySelector('[data-filter-panel]')).toBeNull();
    });

    it('shows date inputs when Välj datum is picked in the panel', async () => {
      const { fixture, page } = await visit({});
      (page.querySelector('[data-filter-button]') as HTMLButtonElement).click();
      await fixture.whenStable();
      const panel = document.querySelector('[data-filter-panel]') as HTMLElement;
      expect(panel.querySelector('[data-from]')).toBeNull();

      (panel.querySelector('[data-period="custom"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      const from = panel.querySelector('[data-from] input') as HTMLInputElement;
      from.value = '2026-11-01';
      from.dispatchEvent(new Event('change'));
      await fixture.whenStable();

      expect(lastRequest().filters.from).toBe('2026-11-01');
    });

    it('links to the manual transaction form', async () => {
      const { page } = await visit({}, response([]));

      expect(page.querySelector('[data-add]')?.getAttribute('href')).toBe('/transaktioner/ny');
    });
  });
});
