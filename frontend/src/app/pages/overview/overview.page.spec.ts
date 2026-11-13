import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  AccountsResponse,
  BankAccounts,
  ConnectedAccount,
  OverviewCategory,
  OverviewResponse,
  OverviewTotals,
  OverviewTransactionsResponse,
  Transaction,
} from '@bankapp/shared';
import { OverviewPage } from './overview.page';

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00'));
    TestBed.configureTestingModule({
      imports: [OverviewPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.useRealTimers();
  });

  const totals = (income: number, spending: number): OverviewTotals => ({
    income,
    spending,
    net: income - spending,
  });

  const category = (
    id: number,
    name: string,
    total: number,
    subcategories: [number, string, number][] = [],
    overrides: Partial<OverviewCategory> = {},
  ): OverviewCategory => ({
    id,
    name,
    kind: 'expense',
    colour: 'green',
    icon: 'utensils',
    total,
    subcategories: subcategories.map(([subId, subName, subTotal]) => ({
      id: subId,
      name: subName,
      icon: 'shopping-basket',
      total: subTotal,
    })),
    ...overrides,
  });

  const overview = (overrides: Partial<OverviewResponse> = {}): OverviewResponse => ({
    month: '2026-11',
    totals: totals(0, 0),
    previous: totals(0, 0),
    categories: [],
    uncategorised: 0,
    ...overrides,
  });

  const account = (name: string, balance: number | null, id = 1): ConnectedAccount => ({
    id,
    name,
    type: 'payment',
    balance: balance === null ? null : { amount: balance, currency: 'SEK' },
    hidden: false,
    share: 'me',
    lastSyncedAt: null,
  });

  const bankGroup = (
    bank: string,
    accounts: ConnectedAccount[],
    overrides: Partial<BankAccounts> = {},
  ): BankAccounts => ({
    bank,
    status: 'active',
    validUntil: '2099-01-01T00:00:00.000Z',
    accounts,
    closedAccounts: [],
    ...overrides,
  });

  const accountsOf = (banks: BankAccounts[]): AccountsResponse => ({
    banks,
    syncing: false,
    lastSync: null,
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
    ...overrides,
  });

  async function render(
    body: OverviewResponse | 'error' = overview(),
    accounts: AccountsResponse | 'error' = accountsOf([]),
  ) {
    const fixture = TestBed.createComponent(OverviewPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const accountsRequest = http.expectOne('/api/accounts');
    if (accounts === 'error') accountsRequest.error(new ProgressEvent('error'));
    else accountsRequest.flush(accounts);
    await answer(http, body);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement, http };
  }

  async function answer(http: HttpTestingController, body: OverviewResponse | 'error') {
    const month = body === 'error' ? '2026-11' : body.month;
    const request = http.expectOne((r) => r.url === '/api/overview');
    expect(request.request.params.get('month')).toBe(month);
    if (body === 'error') request.error(new ProgressEvent('error'));
    else request.flush(body);
    await TestBed.inject(ApplicationRef).whenStable();
  }

  const text = (el: Element | null | undefined) =>
    el?.textContent?.replace(/[ \t\n\r]+/g, ' ').trim();
  const click = async (fixture: { whenStable(): Promise<unknown> }, el: Element | null) => {
    (el as HTMLElement).click();
    await fixture.whenStable();
  };
  const row = (page: HTMLElement, name: string) =>
    page.querySelector(`[data-category-row="${name}"]`);

  it('shows the current month, titled in Swedish', async () => {
    const { page } = await render();

    expect(text(page.querySelector('[data-month]'))).toBe('november 2026');
  });

  describe('totals', () => {
    it('shows income, spending and net with the change from the previous month', async () => {
      const { page } = await render(
        overview({ totals: totals(30000, 12000), previous: totals(28000, 15000) }),
      );

      const total = (kind: string) => page.querySelector(`[data-total="${kind}"]`);
      expect(text(total('income')?.querySelector('[data-amount]'))).toBe('30 000,00 kr');
      expect(text(total('spending')?.querySelector('[data-amount]'))).toBe('12 000,00 kr');
      expect(text(total('net')?.querySelector('[data-amount]'))).toBe('18 000,00 kr');
      expect(text(total('income')?.querySelector('[data-change]'))).toContain('+2 000,00 kr');
      expect(text(total('spending')?.querySelector('[data-change]'))).toContain('−3 000,00 kr');
      expect(text(total('net')?.querySelector('[data-change]'))).toContain('+5 000,00 kr');
    });

    it('says when a total is unchanged', async () => {
      const { page } = await render(overview({ totals: totals(10, 5), previous: totals(10, 5) }));

      expect(text(page.querySelector('[data-total="income"] [data-change]'))).toContain(
        'Oförändrat',
      );
    });
  });

  describe('month navigation', () => {
    it('goes back and forth, but not past the current month', async () => {
      const { fixture, page, http } = await render();
      const previous = () => page.querySelector<HTMLButtonElement>('[data-previous-month]');
      const next = () => page.querySelector<HTMLButtonElement>('[data-next-month]');
      expect(next()?.disabled).toBe(true);

      await click(fixture, previous());
      await answer(http, overview({ month: '2026-10' }));
      expect(text(page.querySelector('[data-month]'))).toBe('oktober 2026');
      expect(next()?.disabled).toBe(false);

      await click(fixture, next());
      await answer(http, overview({ month: '2026-11' }));
      expect(text(page.querySelector('[data-month]'))).toBe('november 2026');
      expect(next()?.disabled).toBe(true);
    });

    it('crosses a year boundary', async () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00'));
      const { fixture, page, http } = await render(overview({ month: '2026-01' }));

      await click(fixture, page.querySelector('[data-previous-month]'));
      await answer(http, overview({ month: '2025-12' }));

      expect(text(page.querySelector('[data-month]'))).toBe('december 2025');
    });
  });

  describe('the breakdown', () => {
    const food = category(2, 'Mat & Dryck', 600, [
      [12, 'Livsmedel', 450],
      [13, 'Restaurang', 150],
    ]);
    const home = category(1, 'Boende & Hushåll', 400, [[20, 'El & värme', 400]], {
      colour: 'blue',
      icon: 'house',
    });
    const salary = category(9, 'Inkomst', 30000, [[40, 'Lön', 30000]], {
      kind: 'income',
      colour: 'emerald',
      icon: 'wallet',
    });
    const body = () =>
      overview({
        totals: totals(30000, 1000),
        categories: [salary, food, home],
      });

    it('lists spending per category as bars, largest first, with amount and share', async () => {
      const { page } = await render(body());

      const rows = Array.from(
        page.querySelectorAll('[data-section="spending"] [data-category-row]'),
      );
      expect(rows.map((r) => r.getAttribute('data-category-row'))).toEqual([
        'Mat & Dryck',
        'Boende & Hushåll',
      ]);
      expect(text(rows[0]?.querySelector('[data-amount]'))).toBe('600,00 kr');
      expect(text(rows[0]?.querySelector('[data-share]'))).toBe('60 %');
      expect(text(rows[1]?.querySelector('[data-share]'))).toBe('40 %');
      expect(rows[0]?.querySelector<HTMLElement>('[data-bar]')?.style.width).toBe('100%');
      expect(rows[1]?.querySelector<HTMLElement>('[data-bar]')?.style.width).toBe('67%');
      expect(rows[0]?.querySelector('[data-bar]')?.getAttribute('style')).toContain(
        '--category-light',
      );
      expect(rows[0]?.querySelector('[data-badge]')).not.toBeNull();
    });

    it('lists income in its own section', async () => {
      const { page } = await render(body());

      const rows = page.querySelectorAll('[data-section="income"] [data-category-row]');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.getAttribute('data-category-row')).toBe('Inkomst');
      expect(text(rows[0]?.querySelector('[data-share]'))).toBe('100 %');
    });

    it('has no income section when there is no income', async () => {
      const { page } = await render(overview({ categories: [food] }));

      expect(page.querySelector('[data-section="income"]')).toBeNull();
    });

    it('opens the subcategories of a tapped category, and closes them on another tap', async () => {
      const { fixture, page } = await render(body());
      expect(page.querySelector('[data-subcategory-row]')).toBeNull();

      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);

      const subs = Array.from(page.querySelectorAll('[data-subcategory-row]'));
      expect(subs.map((s) => s.getAttribute('data-subcategory-row'))).toEqual([
        'Livsmedel',
        'Restaurang',
      ]);
      expect(text(subs[0]?.querySelector('[data-amount]'))).toBe('450,00 kr');
      expect(text(subs[0]?.querySelector('[data-share]'))).toBe('75 %');

      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      expect(page.querySelector('[data-subcategory-row]')).toBeNull();
    });

    it('lists the transactions of a tapped subcategory for that month', async () => {
      const { fixture, page, http } = await render(body());
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);

      await click(fixture, page.querySelector('[data-subcategory-row="Livsmedel"] button'));
      const request = http.expectOne((r) => r.url === '/api/overview/transactions');
      expect(request.request.params.get('month')).toBe('2026-11');
      expect(request.request.params.get('subcategoryId')).toBe('12');
      request.flush({
        transactions: [transaction(1), transaction(2, { date: '2026-11-03' })],
      } satisfies OverviewTransactionsResponse);
      await fixture.whenStable();

      expect(
        Array.from(page.querySelectorAll('li[data-transaction] [data-description]')).map((d) =>
          text(d),
        ),
      ).toEqual(['Köp 1', 'Köp 2']);
      expect(page.querySelector('li[data-transaction] a')?.getAttribute('href')).toBe(
        '/transaktioner/1',
      );
    });

    it('drills into income the same way', async () => {
      const { fixture, page } = await render(body());

      await click(fixture, row(page, 'Inkomst')?.querySelector('button') ?? null);

      expect(page.querySelector('[data-subcategory-row="Lön"]')).not.toBeNull();
    });

    it('shows a failure to fetch the transactions of a subcategory', async () => {
      const { fixture, page, http } = await render(body());
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      await click(fixture, page.querySelector('[data-subcategory-row="Livsmedel"] button'));

      http
        .expectOne((r) => r.url === '/api/overview/transactions')
        .error(new ProgressEvent('error'));
      await fixture.whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
    });

    it('closes what was open when the month changes', async () => {
      const { fixture, page, http } = await render(body());
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);

      await click(fixture, page.querySelector('[data-previous-month]'));
      await answer(http, overview({ month: '2026-10', categories: [food] }));

      expect(page.querySelector('[data-subcategory-row]')).toBeNull();
    });
  });

  describe('Okategoriserat', () => {
    it('shows how many transactions have no category and links to Att granska', async () => {
      const { page } = await render(overview({ uncategorised: 4 }));

      const link = page.querySelector('[data-uncategorised-row]');
      expect(text(link)).toContain('Okategoriserat');
      expect(text(link)).toContain('4');
      expect(link?.getAttribute('href')).toBe('/granska');
    });

    it('is absent when every transaction has a category', async () => {
      const { page } = await render(overview({ uncategorised: 0 }));

      expect(page.querySelector('[data-uncategorised-row]')).toBeNull();
    });
  });

  it('says so when the month has no transactions, and offers to connect a bank without accounts', async () => {
    const { page } = await render();

    expect(page.textContent).toContain('Inga transaktioner den här månaden');
    expect(page.querySelector('a[href="/anslut-bank"]')?.textContent?.trim()).toBe('Anslut bank');
  });

  it('shows an error when the overview cannot be fetched', async () => {
    const { page } = await render('error');

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
  });

  describe('the balance strip', () => {
    const strip = (page: HTMLElement) =>
      Array.from(page.querySelectorAll('[data-balance-strip] li')).map((li) => ({
        name: li.querySelector('[data-account-name]')?.textContent?.trim(),
        balance: li.querySelector('[data-balance]')?.textContent?.trim(),
      }));

    it('shows the name and balance of each open account, without any tap action', async () => {
      const { page } = await render(
        overview(),
        accountsOf([
          bankGroup('Swedbank', [account('Lönekonto', 1234.5, 1), account('Sparkonto', 10, 2)]),
          bankGroup('Coop Mastercard', [account('Kort', -99, 3)]),
        ]),
      );

      expect(strip(page)).toEqual([
        { name: 'Lönekonto', balance: '1 234,50 kr' },
        { name: 'Sparkonto', balance: '10,00 kr' },
        { name: 'Kort', balance: '−99,00 kr' },
      ]);
      expect(page.querySelector('[data-balance-strip] a, [data-balance-strip] button')).toBeNull();
    });

    it('leaves out hidden accounts', async () => {
      const { page } = await render(
        overview(),
        accountsOf([
          bankGroup('Swedbank', [
            account('Lönekonto', 100, 1),
            { ...account('Gömt', 5, 2), hidden: true },
          ]),
        ]),
      );

      expect(strip(page)).toEqual([{ name: 'Lönekonto', balance: '100,00\u00a0kr' }]);
    });

    it('leaves out closed accounts', async () => {
      const { page } = await render(
        overview(),
        accountsOf([
          bankGroup('Swedbank', [account('Lönekonto', 5)], {
            closedAccounts: [account('Gammalt', 7, 9)],
          }),
        ]),
      );

      expect(strip(page).map((a) => a.name)).toEqual(['Lönekonto']);
    });

    it('shows a dash for an account without a balance yet', async () => {
      const { page } = await render(
        overview(),
        accountsOf([bankGroup('Swedbank', [account('Lönekonto', null)])]),
      );

      expect(strip(page)).toEqual([{ name: 'Lönekonto', balance: '–' }]);
    });

    it('is absent when there are no accounts, or they cannot be fetched', async () => {
      const none = await render();
      expect(none.page.querySelector('[data-balance-strip]')).toBeNull();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [OverviewPage],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });

      const failed = await render(overview({ uncategorised: 1 }), 'error');
      expect(failed.page.querySelector('[data-balance-strip]')).toBeNull();
      expect(failed.page.querySelector('[data-uncategorised-row]')).not.toBeNull();
    });
  });

  describe('the connection banner', () => {
    const banner = (page: HTMLElement) => page.querySelector('[data-connection-banner]');

    it.each(['expiring', 'expired'] as const)(
      'links to the Banker page when a connection is %s',
      async (status) => {
        const { page } = await render(
          overview(),
          accountsOf([
            bankGroup('Swedbank', [account('Lönekonto', 5)]),
            bankGroup('Skandia', [account('Spar', 5, 2)], { status }),
          ]),
        );

        expect(banner(page)?.querySelector('a[href="/banker"]')).not.toBeNull();
      },
    );

    it('is absent when every connection is active', async () => {
      const { page } = await render(
        overview(),
        accountsOf([bankGroup('Swedbank', [account('Lönekonto', 5)])]),
      );

      expect(banner(page)).toBeNull();
    });
  });
});
