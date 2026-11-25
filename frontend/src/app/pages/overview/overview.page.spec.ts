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
  SettlementPeriod,
  SettlementResponse,
  Transaction,
} from '@bankapp/shared';
import { Offline } from '../../offline/offline.service';
import { AccountsStore } from '../../stores/accounts.store';
import { FakeAccountsStore } from '../../stores/accounts.store.fake';
import { SettlementStore } from '../../stores/settlement.store';
import { FakeSettlementStore } from '../../stores/settlement.store.fake';
import { OverviewStore } from '../../stores/overview.store';
import { FakeOverviewStore } from '../../stores/overview.store.fake';
import { OverviewPage } from './overview.page';

describe('OverviewPage', () => {
  let overviewStore: FakeOverviewStore;
  let accountsStore: FakeAccountsStore;
  let settlementStore: FakeSettlementStore;

  beforeEach(() => {
    overviewStore = new FakeOverviewStore();
    accountsStore = new FakeAccountsStore();
    settlementStore = new FakeSettlementStore();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00'));
    TestBed.configureTestingModule({
      imports: [OverviewPage],
      providers: [
        provideRouter([]),
        { provide: OverviewStore, useValue: overviewStore },
        { provide: AccountsStore, useValue: accountsStore },
        { provide: SettlementStore, useValue: settlementStore },
      ],
    });
  });

  afterEach(() => {
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
    savings: { subcategoryId: 7, current: 0, previous: 0 },
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
    savings: false,
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
    removedBanks: [],
    syncing: null,
    lastSync: null,
  });

  const period = (month: string, overrides: Partial<SettlementPeriod> = {}): SettlementPeriod => ({
    month,
    closedThrough: null,
    startsOn: null,
    reportSaved: null,
    carriedIn: 0,
    balanceSettings: [],
    items: [],
    payments: [],
    paid: 0,
    carriedOut: 0,
    overdue: false,
    ...overrides,
  });

  /** A bare number is the live balance of an open November. */
  const settlementOf = (setting: number | null | SettlementResponse): SettlementResponse =>
    typeof setting === 'object' && setting !== null
      ? setting
      : {
          balance: setting,
          periods: setting === null ? [] : [period('2026-11', { carriedOut: setting })],
          balanceSettings: [],
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

  async function render(
    body: OverviewResponse | 'error' = overview(),
    accounts: AccountsResponse | 'error' = accountsOf([]),
    settlement: number | null | SettlementResponse | 'error' = null,
    view = 'mine',
  ) {
    if (accounts === 'error') accountsStore.failed.set(true);
    else accountsStore.accounts.set(accounts);
    if (settlement === 'error') settlementStore.failed.set(true);
    else settlementStore.settlement.set(settlementOf(settlement));
    const fixture = TestBed.createComponent(OverviewPage);
    await fixture.whenStable();
    await answer(body, view);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement };
  }

  /** The store's answer for the month and view the page is asking for. */
  async function answer(body: OverviewResponse | 'error', view = 'mine') {
    const month = body === 'error' ? '2026-11' : body.month;
    overviewStore.overviews.update((all) => ({ ...all, [`${month} ${view}`]: body }));
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

  describe('following the stores', () => {
    it('follows the settlement only while the page is open', async () => {
      const { fixture } = await render();
      expect(settlementStore.calls.map((c) => c.method)).toEqual(['activate']);

      fixture.destroy();

      expect(settlementStore.calls.map((c) => c.method)).toEqual(['activate', 'deactivate']);
    });

    it('shows a new answer for the month it is on, such as after a sync finishes', async () => {
      const { fixture, page } = await render(overview({ totals: totals(0, 100) }));

      await answer(overview({ totals: totals(0, 250) }));
      await fixture.whenStable();

      expect(text(page.querySelector('[data-total="spending"] [data-amount]'))).toBe(
        '250,00\u00a0kr',
      );
    });

    it('shows the settlement row once the settlement store has it', async () => {
      const { fixture, page } = await render();
      expect(page.querySelector('[data-total="settlement"]')).toBeNull();

      settlementStore.settlement.set(settlementOf(75));
      await fixture.whenStable();

      expect(text(page.querySelector('[data-total="settlement"] [data-amount]'))).toBe(
        '75,00\u00a0kr',
      );
    });
  });

  describe('the settlement row', () => {
    const card = (page: HTMLElement) => page.querySelector('[data-total="settlement"]');
    /** Opens the page at November, then steps back to `month`. */
    const viewing = async (month: string, settlement: SettlementResponse) => {
      const { fixture, page } = await render(overview(), accountsOf([]), settlement);
      for (let m = 11; m > Number(month.slice(5)); m--) {
        await click(fixture, page.querySelector('[data-previous-month]'));
        await answer(overview({ month: `2026-${String(m - 1).padStart(2, '0')}` }));
        await fixture.whenStable();
      }
      return page;
    };

    it('shows what the partner owes and links to Delat', async () => {
      const { page } = await render(overview(), accountsOf([]), 4312);

      expect(text(card(page)?.querySelector('[data-amount]'))).toBe('4\u00a0312,00\u00a0kr');
      expect(text(card(page))).toContain('Partnern är skyldig dig');
      expect(card(page)?.getAttribute('href')).toBe('/delat?manad=2026-11');
    });

    it('says the reverse when the balance is negative', async () => {
      const { page } = await render(overview(), accountsOf([]), -250);

      expect(text(card(page)?.querySelector('[data-amount]'))).toBe('250,00\u00a0kr');
      expect(text(card(page))).toContain('Du är skyldig partnern');
    });

    it('shows what a closed month paid, with where it was closed and what was left', async () => {
      const page = await viewing('2026-10', {
        balance: 50,
        periods: [
          period('2026-11', { carriedIn: 120, carriedOut: 50 }),
          period('2026-10', { closedThrough: '2026-11-02', paid: 800, carriedOut: 120 }),
        ],
        balanceSettings: [],
      });

      expect(text(card(page)?.querySelector('[data-amount]'))).toBe('800,00\u00a0kr');
      expect(text(card(page))).toContain('Avslutad 2 nov');
      expect(text(card(page))).toContain('120 kr kvar');
      expect(card(page)?.getAttribute('href')).toBe('/delat?manad=2026-10');
    });

    it('marks a closed month with a check and no violet, and an open one with the violet exchange badge', async () => {
      const closed = await viewing('2026-10', {
        balance: 0,
        periods: [period('2026-11'), period('2026-10', { closedThrough: '2026-10-31', paid: 800 })],
        balanceSettings: [],
      });
      expect(text(card(closed)?.querySelector('[data-settlement-badge]'))).toBe('✓');
      expect(card(closed)?.classList.contains('settlement-row-open')).toBe(false);
      expect(text(card(closed))).toContain('Avslutad 31 okt');

      const { page: open } = await render(overview(), accountsOf([]), 4312);
      expect(text(card(open)?.querySelector('[data-settlement-badge]'))).toBe('⇄');
      expect(card(open)?.classList.contains('settlement-row-open')).toBe(true);
    });

    it('does not mention a balance left when the closed month ended even', async () => {
      const page = await viewing('2026-10', {
        balance: 0,
        periods: [period('2026-11'), period('2026-10', { closedThrough: '2026-10-31', paid: 800 })],
        balanceSettings: [],
      });

      expect(text(card(page))).not.toContain('kvar');
    });

    it('keeps a month closed late under its own month', async () => {
      const page = await viewing('2026-10', {
        balance: 0,
        periods: [period('2026-12'), period('2026-10', { closedThrough: '2026-12-03', paid: 300 })],
        balanceSettings: [],
      });

      expect(text(card(page))).toContain('Avslutad 3 dec');
    });

    it('never says that a month is not closed, even when it is overdue', async () => {
      const page = await viewing('2026-10', {
        balance: 90,
        periods: [period('2026-10', { overdue: true, carriedOut: 90 })],
        balanceSettings: [],
      });

      expect(text(card(page))).toContain('Partnern är skyldig dig');
      expect(text(card(page))).not.toContain('inte avslutad');
    });

    it('shows the earlier open month on the current month, linking to it', async () => {
      const { page } = await render(overview(), accountsOf([]), {
        balance: 90,
        periods: [period('2026-10', { overdue: true, carriedOut: 90 })],
        balanceSettings: [],
      });

      expect(text(card(page)?.querySelector('[data-amount]'))).toBe('90,00\u00a0kr');
      expect(text(card(page))).not.toContain('inte avslutad');
      expect(card(page)?.getAttribute('href')).toBe('/delat?manad=2026-10');
    });

    it('is hidden for a month without a period', async () => {
      const page = await viewing('2026-09', {
        balance: 0,
        periods: [period('2026-11'), period('2026-10', { closedThrough: '2026-10-31' })],
        balanceSettings: [],
      });

      expect(card(page)).toBeNull();
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
      expect(text(page.querySelector('[data-chart-summary]'))).toBe(
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

      expect(text(page.querySelector('[data-chart-summary]'))).toContain(
        '600,00 kr mindre än vid samma tidpunkt förra månaden (1 200,00 kr)',
      );
    });

    it('draws a past month in full, against the month before it', async () => {
      const { fixture, page } = await render();

      await click(fixture, page.querySelector('[data-previous-month]'));
      await answer(
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
      expect(text(page.querySelector('[data-chart-summary]'))).toBe(
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

    describe('axes and hovering', () => {
      const plain = (value: string | undefined) => value?.replace(/\u00a0/g, ' ');
      const ticks = (page: HTMLElement, axis: 'x' | 'y') =>
        Array.from(page.querySelectorAll(`[data-${axis}-tick]`)).map((t) => plain(text(t)));
      const data = () =>
        overview({
          totals: totals(0, 1500),
          previous: totals(0, 3100),
          spendingByDay: { current: ramp(30, 100), previous: ramp(31, 100) },
        });
      const hover = async (
        fixture: { whenStable(): Promise<unknown> },
        page: HTMLElement,
        day: number,
      ) => {
        page
          .querySelector(`[data-chart-column="${day}"]`)
          ?.dispatchEvent(new Event('pointerenter', { bubbles: false }));
        await fixture.whenStable();
      };
      const tooltip = (page: HTMLElement) => page.querySelector('[data-chart-tooltip]');

      it('labels the amounts on the y axis and the days on the x axis', async () => {
        const { page } = await render(data());

        expect(ticks(page, 'y')).toEqual(['0 kr', '1 550 kr', '3 100 kr']);
        expect(ticks(page, 'x')).toEqual(['1', '8', '15', '22', '31']);
      });

      it('shows both months amounts and dates for the hovered day', async () => {
        const { fixture, page } = await render(data());
        expect(tooltip(page)).toBeNull();

        await hover(fixture, page, 10);

        const said = plain(text(tooltip(page)));
        expect(said).toContain('10 nov 1 000,00 kr');
        expect(said).toContain('10 okt 1 000,00 kr');
      });

      it('shows only last month for a day that has not come yet', async () => {
        const { fixture, page } = await render(data());

        await hover(fixture, page, 20);

        expect(plain(text(tooltip(page)))).toBe('20 okt 2 000,00 kr');
      });

      it('hides the tooltip when the pointer leaves the chart', async () => {
        const { fixture, page } = await render(data());
        await hover(fixture, page, 10);

        page
          .querySelector('[data-chart-plot]')
          ?.dispatchEvent(new Event('pointerleave', { bubbles: false }));
        await fixture.whenStable();

        expect(tooltip(page)).toBeNull();
      });
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
      expect(text(total('net')?.querySelector('[data-change]'))).toBe('Hittills den här månaden');
    });

    it('shows one Netto card with In, Ut and Varav sparande inside it, then the Avräkning row', async () => {
      const { page } = await render(overview(), accountsOf([]), 10);

      expect(
        Array.from(page.querySelectorAll('[data-total]')).map((t) => t.getAttribute('data-total')),
      ).toEqual(['net', 'income', 'spending', 'savings', 'settlement']);
      const net = page.querySelector('[data-total="net"]');
      for (const kind of ['income', 'spending', 'savings']) {
        expect(net?.querySelector(`[data-total="${kind}"]`)).not.toBeNull();
      }
      expect(net?.querySelector('[data-total="settlement"]')).toBeNull();
      expect(page.querySelector('.stat-tile')).toBeNull();
    });

    it('labels the boxes In and Ut and the slim row Varav sparande', async () => {
      const { page } = await render(
        overview({ savings: { subcategoryId: 7, current: 3500, previous: 3000 } }),
      );

      const label = (kind: string) => text(page.querySelector(`[data-total="${kind}"] .eyebrow`));
      expect(label('net')).toContain('Netto');
      expect(label('income')).toBe('In');
      expect(label('spending')).toBe('Ut');
      expect(text(page.querySelector('[data-total="savings"]'))).toContain('Varav sparande');
    });

    it('shows the month’s savings, linking to its transactions', async () => {
      const { page } = await render(
        overview({ savings: { subcategoryId: 7, current: 3500, previous: 3000 } }),
      );

      const row = page.querySelector('[data-total="savings"]');
      expect(text(row?.querySelector('[data-amount]'))?.replace(/\s/g, ' ')).toBe('3 500,00 kr');
      expect(row?.getAttribute('href')).toBe(
        '/transaktioner?from=2026-11-01&to=2026-11-30&subcategories=7',
      );
    });

    it('leaves out Varav sparande when there is no savings subcategory', async () => {
      const { page } = await render(
        overview({ savings: { subcategoryId: null, current: 0, previous: 0 } }),
      );

      expect(page.querySelector('[data-total="savings"]')).toBeNull();
    });

    it('does not link the netto card', async () => {
      const { page } = await render();

      expect(page.querySelector('[data-total="net"]')?.tagName).not.toBe('A');
    });

    it('compares In and Ut with the whole previous month, also in the current month', async () => {
      const { page } = await render(overview({ totals: totals(10, 5), previous: totals(40, 20) }));

      expect(
        text(page.querySelector('[data-total="income"] [data-change]'))?.replace(/\s/g, ' '),
      ).toContain('−30,00 kr');
      expect(
        text(page.querySelector('[data-total="spending"] [data-change]'))?.replace(/\s/g, ' '),
      ).toContain('−15,00 kr');
    });

    it('says when a total is unchanged', async () => {
      const { page } = await render(overview({ totals: totals(10, 5), previous: totals(10, 5) }));

      expect(text(page.querySelector('[data-total="income"] [data-change]'))).toContain(
        'Oförändrat',
      );
    });
  });

  describe('the Netto card', () => {
    const net = (page: HTMLElement) => page.querySelector('[data-total="net"]');
    const bar = (page: HTMLElement) => net(page)?.querySelector('[data-net-bar]');
    const caption = (page: HTMLElement) => text(net(page)?.querySelector('[data-net-caption]'));
    const grey = (page: HTMLElement) =>
      (bar(page)?.querySelector('[data-bar-spending]') as HTMLElement | null)?.style.width;
    const amount = (page: HTMLElement) => net(page)?.querySelector('[data-amount]');
    /** Opens November, then steps back to October. */
    const lastMonth = async (body: OverviewResponse) => {
      const { fixture, page } = await render();
      await click(fixture, page.querySelector('[data-previous-month]'));
      await answer(body);
      await fixture.whenStable();
      return page;
    };

    it('shows a positive past month in green, as a share of income kept', async () => {
      const page = await lastMonth(
        overview({ month: '2026-10', totals: totals(10000, 8900), previous: totals(10000, 9000) }),
      );

      expect(amount(page)?.classList.contains('text-positive')).toBe(true);
      expect(net(page)?.classList.contains('net-card-positive')).toBe(true);
      expect(caption(page)).toBe('Du behöll 11 % av inkomsterna');
      expect(grey(page)).toBe('89%');
      expect(bar(page)?.getAttribute('role')).toBe('img');
      expect(bar(page)?.getAttribute('aria-label')).toBe('Du behöll 11 % av inkomsterna');
      expect(net(page)?.querySelector('[data-ongoing]')).toBeNull();
    });

    it('shows a negative past month in red, as spending over income', async () => {
      const page = await lastMonth(
        overview({ month: '2026-10', totals: totals(10000, 11850), previous: totals(0, 0) }),
      );

      expect(amount(page)?.classList.contains('text-danger')).toBe(true);
      expect(net(page)?.classList.contains('net-card-negative')).toBe(true);
      expect(caption(page)?.replace(/\s/g, ' ')).toBe('Du spenderade 1 850 kr mer än du fick in');
      expect(grey(page)).toBe('84%');
      expect(bar(page)?.getAttribute('aria-label')?.replace(/\s/g, ' ')).toBe(
        'Du spenderade 1 850 kr mer än du fick in',
      );
    });

    it('shows a negative current month neutral, as use of last month’s income, never red', async () => {
      const { page } = await render(
        overview({ totals: totals(0, 21500), previous: totals(38450, 30000) }),
      );

      expect(amount(page)?.classList.contains('text-danger')).toBe(false);
      expect(amount(page)?.classList.contains('text-positive')).toBe(false);
      expect(net(page)?.classList.contains('net-card-negative')).toBe(false);
      expect(net(page)?.classList.contains('net-card-positive')).toBe(false);
      expect(text(net(page)?.querySelector('[data-ongoing]'))).toBe('Pågår');
      expect(text(net(page)?.querySelector('[data-change]'))).toBe('Hittills den här månaden');
      expect(caption(page)?.replace(/\s/g, ' ')).toBe(
        'Du har använt 56 % av förra månadens inkomster (38 450 kr)',
      );
      expect(grey(page)).toBe('56%');
      expect(net(page)?.innerHTML).not.toContain('danger');
    });

    it('stops the bar of a current month at 100 %', async () => {
      const { page } = await render(
        overview({ totals: totals(0, 50000), previous: totals(40000, 0) }),
      );

      expect(grey(page)).toBe('100%');
    });

    it('treats a current month with income ahead of spending like a positive past month', async () => {
      const { page } = await render(overview({ totals: totals(20000, 15000) }));

      expect(amount(page)?.classList.contains('text-positive')).toBe(true);
      expect(text(net(page)?.querySelector('[data-ongoing]'))).toBe('Pågår');
      expect(caption(page)).toBe('Du behöll 25 % av inkomsterna');
    });

    it('leaves out the bar when the income it is measured against is 0', async () => {
      const { page } = await render(overview({ totals: totals(0, 500), previous: totals(0, 0) }));

      expect(bar(page)).toBeNull();
      expect(caption(page)).toBeUndefined();
      expect(text(amount(page))?.replace(/\s/g, ' ')).toBe('−500,00 kr');
    });

    it('leaves out the bar on a past month with neither income nor spending', async () => {
      const page = await lastMonth(overview({ month: '2026-10' }));

      expect(bar(page)).toBeNull();
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

    it('defaults to Min andel and asks the store for it', async () => {
      const { page } = await render();

      expect(overviewStore.requested.overview).toEqual([{ month: '2026-11', view: 'mine' }]);
      expect(toggle(page, 'mine')?.getAttribute('aria-pressed')).toBe('true');
      expect(toggle(page, 'full')?.getAttribute('aria-pressed')).toBe('false');
      expect(text(toggle(page, 'mine'))).toBe('Min andel');
      expect(text(toggle(page, 'full'))).toBe('Hela beloppet');
    });

    it('shows the other view when it is chosen, and remembers the choice on the device', async () => {
      const { fixture, page } = await render();

      await click(fixture, toggle(page, 'full'));
      expect(overviewStore.requested.overview.at(-1)).toEqual({ month: '2026-11', view: 'full' });
      expect(page.querySelector('[aria-busy]')).not.toBeNull();
      await answer(overview({ totals: totals(0, 200) }), 'full');
      await fixture.whenStable();
      expect(text(page.querySelector('[data-total="spending"] [data-amount]'))).toBe(
        '200,00\u00a0kr',
      );
      expect(localStorage.getItem('overview-view')).toBe('full');
      expect(toggle(page, 'full')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('starts in the remembered view', async () => {
      localStorage.setItem('overview-view', 'full');
      await render(overview(), accountsOf([]), null, 'full');

      expect(overviewStore.requested.overview).toEqual([{ month: '2026-11', view: 'full' }]);
    });

    const drillDown = (month: string, id: number, transactions: Transaction[]) =>
      overviewStore.drillDowns.update((all) => ({
        ...all,
        [`${month} ${id}`]: { transactions } satisfies OverviewTransactionsResponse,
      }));

    it('shows din del on shared drill-down rows in Min andel, with real amounts', async () => {
      const { fixture, page } = await render(body());
      drillDown('2026-11', 12, [
        transaction(1, {
          amount: { amount: -200, currency: 'SEK' },
          share: { option: 'half', percent: 50, source: 'account' },
          ownerPart: -100,
        }),
        transaction(2),
      ]);
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      await click(fixture, page.querySelector('[data-subcategory-row="Livsmedel"] button'));

      const rows = page.querySelectorAll('li[data-transaction]');
      expect(text(rows[0]?.querySelector('[data-amount]'))).toBe('−200,00\u00a0kr');
      expect(text(rows[0]?.querySelector('[data-own-share]'))).toBe('din del −100,00\u00a0kr');
      expect(rows[1]?.querySelector('[data-own-share]')).toBeNull();
    });

    it('leaves out din del in Hela beloppet', async () => {
      localStorage.setItem('overview-view', 'full');
      const { fixture, page } = await render(body(), accountsOf([]), null, 'full');
      drillDown('2026-11', 12, [
        transaction(1, { share: { option: 'half', percent: 50, source: 'account' } }),
      ]);
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      await click(fixture, page.querySelector('[data-subcategory-row="Livsmedel"] button'));

      expect(page.querySelector('[data-own-share]')).toBeNull();
      expect(text(page.querySelector('[data-share-badge]'))).toBe('50/50');
    });
  });

  describe('month navigation', () => {
    it('goes back and forth, but not past the current month', async () => {
      const { fixture, page } = await render();
      const previous = () => page.querySelector<HTMLButtonElement>('[data-previous-month]');
      const next = () => page.querySelector<HTMLButtonElement>('[data-next-month]');
      expect(next()?.disabled).toBe(true);

      await click(fixture, previous());
      await answer(overview({ month: '2026-10' }));
      expect(text(page.querySelector('[data-month]'))).toBe('oktober 2026');
      expect(next()?.disabled).toBe(false);

      await click(fixture, next());
      await answer(overview({ month: '2026-11' }));
      expect(text(page.querySelector('[data-month]'))).toBe('november 2026');
      expect(next()?.disabled).toBe(true);
    });

    it('crosses a year boundary', async () => {
      vi.setSystemTime(new Date('2026-01-15T12:00:00'));
      const { fixture, page } = await render(overview({ month: '2026-01' }));

      await click(fixture, page.querySelector('[data-previous-month]'));
      await answer(overview({ month: '2025-12' }));

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
        '/transaktioner?from=2026-11-01&to=2026-11-30&subcategories=7',
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
      const { fixture, page } = await render(body());
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      expect(overviewStore.requested.drillDown).toEqual([]);

      await click(fixture, page.querySelector('[data-subcategory-row="Livsmedel"] button'));
      expect(overviewStore.requested.drillDown).toEqual([{ month: '2026-11', subcategoryId: 12 }]);
      expect(page.querySelector('[data-subcategory-row="Livsmedel"] [aria-busy]')).not.toBeNull();
      overviewStore.drillDowns.set({
        '2026-11 12': { transactions: [transaction(1), transaction(2, { date: '2026-11-03' })] },
      });
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
      const { fixture, page } = await render(body());
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);
      overviewStore.drillDowns.set({ '2026-11 12': 'error' });
      await click(fixture, page.querySelector('[data-subcategory-row="Livsmedel"] button'));

      expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
    });

    it('closes what was open when the month changes', async () => {
      const { fixture, page } = await render(body());
      await click(fixture, row(page, 'Mat & Dryck')?.querySelector('button') ?? null);

      await click(fixture, page.querySelector('[data-previous-month]'));
      await answer(overview({ month: '2026-10', categories: [food] }));

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

  it('says Inte sparad, not an error, for a month that was never saved while offline', async () => {
    TestBed.inject(Offline).markOffline();
    const { page } = await render('error');

    expect(page.querySelector('[data-not-saved]')?.textContent).toContain('Inte sparad');
    expect(page.querySelector('[role=alert]')).toBeNull();
  });

  it('still shows today’s empty state for a month without transactions, offline or not', async () => {
    TestBed.inject(Offline).markOffline();
    const { page } = await render();

    expect(page.textContent).toContain('Inga transaktioner den här månaden');

    expect(page.querySelector('[data-not-saved]')).toBeNull();
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

    it('keeps a savings account listed with its balance, marked as such', async () => {
      const { page } = await render(
        overview(),
        accountsOf([bankGroup('Swedbank', [{ ...account('Buffert', 500, 1), savings: true }])]),
      );

      expect(strip(page)).toEqual([{ name: 'Buffert', balance: '500,00 kr' }]);
      expect(page.querySelector('[data-account-detail]')?.textContent).toContain('Sparkonto');
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
        providers: [
          provideRouter([]),
          { provide: OverviewStore, useValue: overviewStore },
          { provide: AccountsStore, useValue: (accountsStore = new FakeAccountsStore()) },
          { provide: SettlementStore, useValue: settlementStore },
        ],
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
