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
    localStorage.clear();
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
    spendingByDay: { current: Array(30).fill(0), previous: Array(31).fill(0) },
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
    paidBy: 'owner',
    ...overrides,
  });

  async function render(
    body: OverviewResponse | 'error' = overview(),
    accounts: AccountsResponse | 'error' = accountsOf([]),
    settlement: number | null | 'error' = null,
  ) {
    const fixture = TestBed.createComponent(OverviewPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const accountsRequest = http.expectOne('/api/accounts');
    if (accounts === 'error') accountsRequest.error(new ProgressEvent('error'));
    else accountsRequest.flush(accounts);
    const settlementRequest = http.expectOne('/api/settlement/balance');
    if (settlement === 'error') settlementRequest.error(new ProgressEvent('error'));
    else settlementRequest.flush({ balance: settlement });
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

  describe('the settlement tile', () => {
    const card = (page: HTMLElement) => page.querySelector('[data-total="settlement"]');

    it('shows what the partner owes and links to Delat', async () => {
      const { page } = await render(overview(), accountsOf([]), 4312);

      expect(text(card(page)?.querySelector('[data-amount]'))).toBe('4\u00a0312,00\u00a0kr');
      expect(text(card(page))).toContain('Partnern är skyldig dig');
      expect(card(page)?.getAttribute('href')).toBe('/delat');
    });

    it('says the reverse when the balance is negative', async () => {
      const { page } = await render(overview(), accountsOf([]), -250);

      expect(text(card(page)?.querySelector('[data-amount]'))).toBe('250,00\u00a0kr');
      expect(text(card(page))).toContain('Du är skyldig partnern');
    });

    it('is hidden when there is no balance setting', async () => {
      const { page } = await render();

      expect(card(page)).toBeNull();
    });

    it('is hidden when the balance cannot be fetched', async () => {
      const { page } = await render(overview(), accountsOf([]), 'error');

      expect(card(page)).toBeNull();
    });
  });

  describe('the spending comparison chart', () => {
    /** Cumulative spending: `step` kr more each day. */
    const ramp = (days: number, step: number) =>
      Array.from({ length: days }, (_, i) => (i + 1) * step);
    const chart = (page: HTMLElement) => page.querySelector('[data-spending-chart]');
    const points = (page: HTMLElement, line: string) =>
      page
        .querySelector(`[data-spending-chart] [data-line="${line}"]`)
        ?.getAttribute('points')
        ?.split(' ').length;

    it('draws this month up to today against the whole previous month', async () => {
      const { page } = await render(
        overview({
          totals: totals(0, 1500),
          previous: totals(0, 3100),
          spendingByDay: { current: ramp(30, 100), previous: ramp(31, 100) },
        }),
      );

      expect(points(page, 'current')).toBe(15);
      expect(points(page, 'previous')).toBe(31);
    });

    it('says how far ahead or behind last month the spending is on the same day', async () => {
      const { page } = await render(
        overview({
          totals: totals(0, 1500),
          previous: totals(0, 3100),
          spendingByDay: { current: ramp(30, 100), previous: ramp(31, 80) },
        }),
      );

      // Day 15: 1 500 kr this month against 1 200 kr at the same point last month.
      expect(text(page.querySelector('[data-spending-chart-summary]'))).toBe(
        'Hittills 1 500,00 kr, 300,00 kr mer än vid samma tidpunkt förra månaden (1 200,00 kr).',
      );
    });

    it('says less when spending is below last month', async () => {
      const { page } = await render(
        overview({
          totals: totals(0, 600),
          previous: totals(0, 3100),
          spendingByDay: { current: ramp(30, 40), previous: ramp(31, 80) },
        }),
      );

      expect(text(page.querySelector('[data-spending-chart-summary]'))).toContain(
        '600,00 kr mindre än vid samma tidpunkt förra månaden (1 200,00 kr)',
      );
    });

    it('draws a past month in full, against the month before it', async () => {
      const { fixture, page, http } = await render();

      await click(fixture, page.querySelector('[data-previous-month]'));
      await answer(
        http,
        overview({
          month: '2026-10',
          totals: totals(0, 3100),
          previous: totals(0, 3000),
          spendingByDay: { current: ramp(31, 100), previous: ramp(30, 100) },
        }),
      );
      await fixture.whenStable();

      expect(points(page, 'current')).toBe(31);
      expect(points(page, 'previous')).toBe(30);
      expect(text(page.querySelector('[data-spending-chart-summary]'))).toBe(
        'Totalt 3 100,00 kr, 100,00 kr mer än förra månaden (3 000,00 kr).',
      );
    });

    it('still draws this month on its first day', async () => {
      vi.setSystemTime(new Date('2026-11-01T12:00:00'));
      const { page } = await render(
        overview({
          totals: totals(0, 100),
          spendingByDay: { current: ramp(30, 100), previous: ramp(31, 100) },
        }),
      );

      expect(page.querySelector('[data-line="current"]')?.getAttribute('points')).toMatch(/\d/);
    });

    it('is left out when neither month has any spending', async () => {
      const { page } = await render();

      expect(chart(page)).toBeNull();
    });
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

    it('shows four tiles: netto, inkomster, utgifter and avräkning', async () => {
      const { page } = await render(overview(), accountsOf([]), 10);

      expect(
        Array.from(page.querySelectorAll('[data-total]')).map((t) => t.getAttribute('data-total')),
      ).toEqual(['net', 'income', 'spending', 'settlement']);
    });

    it('does not link the netto tile', async () => {
      const { page } = await render();

      expect(page.querySelector('[data-total="net"]')?.tagName).not.toBe('A');
    });

    it('says when a total is unchanged', async () => {
      const { page } = await render(overview({ totals: totals(10, 5), previous: totals(10, 5) }));

      expect(text(page.querySelector('[data-total="income"] [data-change]'))).toContain(
        'Oförändrat',
      );
    });
  });

  describe('Min andel / Hela beloppet', () => {
    const body = () =>
      overview({
        totals: totals(0, 200),
        categories: [category(1, 'Mat & Dryck', 200, [[12, 'Livsmedel', 200]])],
      });
    const toggle = (page: HTMLElement, view: string) =>
      page.querySelector<HTMLButtonElement>(`[data-view-toggle] [data-view="${view}"]`);

    it('defaults to Min andel and asks the backend for it', async () => {
      const fixture = TestBed.createComponent(OverviewPage);
      await fixture.whenStable();
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/api/accounts').flush(accountsOf([]));
      http.expectOne('/api/settlement/balance').flush({ balance: null });
      const request = http.expectOne((r) => r.url === '/api/overview');
      expect(request.request.params.get('view')).toBe('mine');
      request.flush(overview());
      await fixture.whenStable();
      const page = fixture.nativeElement as HTMLElement;
      expect(toggle(page, 'mine')?.getAttribute('aria-pressed')).toBe('true');
      expect(toggle(page, 'full')?.getAttribute('aria-pressed')).toBe('false');
      expect(text(toggle(page, 'mine'))).toBe('Min andel');
      expect(text(toggle(page, 'full'))).toBe('Hela beloppet');
    });

    it('refetches with the other view and remembers the choice on the device', async () => {
      const { fixture, page, http } = await render();

      await click(fixture, toggle(page, 'full'));
      const request = http.expectOne((r) => r.url === '/api/overview');
      expect(request.request.params.get('view')).toBe('full');
      request.flush(overview({ totals: totals(0, 200) }));
      await fixture.whenStable();
      expect(text(page.querySelector('[data-total="spending"] [data-amount]'))).toBe(
        '200,00\u00a0kr',
      );
      expect(localStorage.getItem('overview-view')).toBe('full');
      expect(toggle(page, 'full')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('starts in the remembered view', async () => {
      localStorage.setItem('overview-view', 'full');
      const fixture = TestBed.createComponent(OverviewPage);
      await fixture.whenStable();
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/api/accounts').flush(accountsOf([]));
      http.expectOne('/api/settlement/balance').flush({ balance: null });
      const request = http.expectOne((r) => r.url === '/api/overview');
      expect(request.request.params.get('view')).toBe('full');
      request.flush(overview());
      await fixture.whenStable();
    });

    it('shows din andel on shared drill-down rows in Min andel, with real amounts', async () => {
      const { fixture, page, http } = await render(body());
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      await click(fixture, page.querySelector('[data-subcategory-row="Livsmedel"] button'));
      http
        .expectOne((r) => r.url === '/api/overview/transactions')
        .flush({
          transactions: [
            transaction(1, {
              amount: { amount: -200, currency: 'SEK' },
              share: { option: 'half', percent: 50, source: 'account' },
            }),
            transaction(2),
          ],
        } satisfies OverviewTransactionsResponse);
      await fixture.whenStable();

      const rows = page.querySelectorAll('li[data-transaction]');
      expect(text(rows[0]?.querySelector('[data-amount]'))).toBe('−200,00\u00a0kr');
      expect(text(rows[0]?.querySelector('[data-own-share]'))).toBe('din andel −100,00\u00a0kr');
      expect(rows[1]?.querySelector('[data-own-share]')).toBeNull();
    });

    it('leaves out din andel in Hela beloppet', async () => {
      localStorage.setItem('overview-view', 'full');
      const fixture = TestBed.createComponent(OverviewPage);
      await fixture.whenStable();
      const http = TestBed.inject(HttpTestingController);
      http.expectOne('/api/accounts').flush(accountsOf([]));
      http.expectOne('/api/settlement/balance').flush({ balance: null });
      http.expectOne((r) => r.url === '/api/overview').flush(body());
      await fixture.whenStable();
      const page = fixture.nativeElement as HTMLElement;
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      await click(fixture, page.querySelector('[data-subcategory-row="Livsmedel"] button'));
      http
        .expectOne((r) => r.url === '/api/overview/transactions')
        .flush({
          transactions: [
            transaction(1, { share: { option: 'half', percent: 50, source: 'account' } }),
          ],
        } satisfies OverviewTransactionsResponse);
      await fixture.whenStable();

      expect(page.querySelector('[data-own-share]')).toBeNull();
      expect(text(page.querySelector('[data-share-badge]'))).toBe('50/50');
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

    it('links the totals and an expanded category to Transaktioner for the month', async () => {
      const { fixture, page } = await render(body());

      const links = Array.from(page.querySelectorAll('a[data-total-link]')).map((a) =>
        a.getAttribute('href'),
      );
      expect(links).toEqual([
        '/transaktioner?from=2026-11-01&to=2026-11-30&kind=in',
        '/transaktioner?from=2026-11-01&to=2026-11-30&kind=out',
      ]);

      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      expect(
        row(page, 'Mat & Dryck')?.querySelector('[data-category-link]')?.getAttribute('href'),
      ).toBe('/transaktioner?from=2026-11-01&to=2026-11-30&categories=2');
      expect(text(row(page, 'Mat & Dryck')?.querySelector('[data-category-link]'))).toBe(
        'Visa transaktionerna →',
      );
    });

    it('draws a donut with a segment per category and the total in the middle', async () => {
      const { page } = await render(body());

      const segments = Array.from(page.querySelectorAll('[data-donut] [data-segment]'));
      expect(segments.map((s) => s.getAttribute('data-segment'))).toEqual([
        'Mat & Dryck',
        'Boende & Hushåll',
      ]);
      expect(text(page.querySelector('[data-donut-total]'))?.replace(/\s/g, ' ')).toBe(
        '1 000,00 kr',
      );
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
        '--category-colour',
      );
      expect(rows[0]?.querySelector('[data-badge]')).not.toBeNull();
    });

    it('has no separate income breakdown', async () => {
      const { page } = await render(body());

      expect(page.querySelector('[data-section="income"]')).toBeNull();
      expect(page.querySelector('[data-category-row="Inkomst"]')).toBeNull();
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
      expect(text(link)).toContain('4 okategoriserade transaktioner');
      expect(text(link)).toContain('Granska →');
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

  describe('the accounts card', () => {
    const strip = (page: HTMLElement) =>
      Array.from(page.querySelectorAll('[data-accounts] li')).map((li) => ({
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
      expect(page.querySelector('[data-accounts] li a, [data-accounts] li button')).toBeNull();
    });

    it('shows the bank and account type, a monogram, and links to Banker', async () => {
      const { page } = await render(
        overview(),
        accountsOf([bankGroup('Swedbank', [account('Lönekonto', 5)])]),
      );

      const li = page.querySelector('[data-accounts] li');
      expect(text(li?.querySelector('[data-account-detail]'))).toBe('Swedbank · Betalkonto');
      expect(text(li?.querySelector('[data-monogram]'))).toBe('S');
      expect(page.querySelector('[data-accounts] a[href="/banker"]')).not.toBeNull();
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
      expect(none.page.querySelector('[data-accounts]')).toBeNull();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [OverviewPage],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
      });

      const failed = await render(overview({ uncategorised: 1 }), 'error');
      expect(failed.page.querySelector('[data-accounts]')).toBeNull();
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

    it('says which bank expires and in how many days, with a link to renew', async () => {
      const { page } = await render(
        overview(),
        accountsOf([
          bankGroup('Skandia', [account('Spar', 5, 2)], {
            status: 'expiring',
            validUntil: new Date(Date.now() + 5 * 86_400_000 - 1000).toISOString(),
          }),
        ]),
      );

      expect(text(banner(page))).toContain('Kopplingen till Skandia går ut om 5 dagar.');
      expect(text(banner(page)?.querySelector('a'))).toBe('Förnya →');
    });

    it('says when a connection has expired', async () => {
      const { page } = await render(
        overview(),
        accountsOf([bankGroup('Skandia', [account('Spar', 5, 2)], { status: 'expired' })]),
      );

      expect(text(banner(page))).toContain('Kopplingen till Skandia har gått ut.');
    });

    it('is absent when every connection is active', async () => {
      const { page } = await render(
        overview(),
        accountsOf([bankGroup('Swedbank', [account('Lönekonto', 5)])]),
      );

      expect(banner(page)).toBeNull();
    });
  });
});
