import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  CategoriesResponse,
  Category,
  HouseholdRatioEntry,
  SettlementPeriod,
  SettlementResponse,
  SubcategoryShare,
} from '@bankapp/shared';
import { type Observable, map, of, throwError } from 'rxjs';
import { routes } from '../../app.routes';
import { CategoriesService } from '../../categories.service';
import { SettlementStore } from '../../stores/settlement.store';
import { FakeSettlementStore } from '../../stores/settlement.store.fake';
import { SharesStore } from '../../stores/shares.store';
import { FakeSharesStore } from '../../stores/shares.store.fake';
import { ToastService } from '../../toast/toast.service';
import { DelatPage } from './delat.page';

describe('DelatPage', () => {
  let settlementStore: FakeSettlementStore;
  let sharesStore: FakeSharesStore;
  let categoriesRead: () => Observable<Category[]>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00'));
    settlementStore = new FakeSettlementStore();
    sharesStore = new FakeSharesStore();
    categoriesRead = () => of(categories.categories);
    TestBed.configureTestingModule({
      imports: [DelatPage],
      providers: [
        provideRouter([]),
        { provide: SettlementStore, useValue: settlementStore },
        { provide: SharesStore, useValue: sharesStore },
        {
          provide: CategoriesService,
          useValue: {
            list: () => categoriesRead(),
            subcategories: () =>
              categoriesRead().pipe(
                map((all) =>
                  all.flatMap((category) =>
                    category.subcategories.map((subcategory) => ({ category, subcategory })),
                  ),
                ),
              ),
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const categories: CategoriesResponse = {
    categories: [
      {
        id: 1,
        name: 'Boende & Hushåll',
        kind: 'expense',
        colour: 'blue',
        icon: 'building-2',
        fixed: false,
        subcategories: [
          { id: 10, name: 'Bolån', icon: 'building-2' },
          { id: 11, name: 'Bredband', icon: 'zap' },
        ],
      },
      {
        id: 2,
        name: 'Mat & Dryck',
        kind: 'expense',
        colour: 'green',
        icon: 'utensils',
        fixed: false,
        subcategories: [{ id: 20, name: 'Restaurang', icon: 'utensils' }],
      },
    ],
  };

  const today = '2026-11-15';

  const period = (overrides: Partial<SettlementPeriod> = {}): SettlementPeriod => ({
    month: '2026-11',
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

  const settlementOf = (overrides: Partial<SettlementResponse> = {}): SettlementResponse => ({
    balance: null,
    periods: [],
    balanceSettings: [],
    ...overrides,
  });

  async function render(
    options: {
      ratio?: HouseholdRatioEntry[];
      shares?: SubcategoryShare[];
      settlement?: SettlementResponse;
    } = {},
  ) {
    const {
      ratio = 'ratio' in options ? undefined : [{ from: '2026-01-01', percent: 60 }],
      shares = 'shares' in options ? undefined : [{ subcategoryId: 10, share: 'household' }],
      settlement = 'settlement' in options ? undefined : settlementOf(),
    } = options;
    settlementStore.settlement.set(settlement);
    sharesStore.householdRatio.set(ratio);
    sharesStore.subcategoryShares.set(shares);
    const fixture = TestBed.createComponent(DelatPage);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement };
  }

  /** The arguments of each call to a store method, in order. */
  const callsTo = (store: FakeSettlementStore | FakeSharesStore, method: string) =>
    store.calls.filter((call) => call.method === method).map((call) => call.args);

  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
  /** Picks a month in a month field. */
  const pick = (page: HTMLElement, selector: string, month: string) => {
    const input = page.querySelector<HTMLInputElement>(`${selector} input`)!;
    input.value = month;
    input.dispatchEvent(new Event('change'));
  };
  /** Opens the ⋯ menu inside `scope`. */
  const openMenu = async (fixture: { whenStable(): Promise<unknown> }, scope: Element) => {
    scope.querySelector<HTMLButtonElement>('[data-menu-trigger]')!.click();
    await fixture.whenStable();
  };
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('redirects the old Andelar and Avräkning routes to Delat', () => {
    const children = routes.find((r) => r.path === '')?.children ?? [];
    for (const old of ['andelar', 'avrakning']) {
      expect(children.find((r) => r.path === old)?.redirectTo).toBe('delat');
    }
  });

  it('says when it cannot be fetched', async () => {
    categoriesRead = () => throwError(() => new Error('down'));
    const fixture = TestBed.createComponent(DelatPage);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')).not.toBeNull();
  });

  it('follows the settlement and the shares only while it is open', async () => {
    const { fixture } = await render();
    expect(callsTo(settlementStore, 'activate')).toHaveLength(1);
    expect(callsTo(sharesStore, 'activate')).toHaveLength(1);

    fixture.destroy();
    expect(callsTo(settlementStore, 'deactivate')).toHaveLength(1);
    expect(callsTo(sharesStore, 'deactivate')).toHaveLength(1);
  });

  it('still shows the household ratio and the shared subcategories when the settlement cannot be fetched', async () => {
    settlementStore.failed.set(true);
    const { page } = await render({ settlement: undefined });

    expect(text(page.querySelector('[data-balance-card] [role=alert]'))).toContain(
      'Avräkningen kunde inte hämtas',
    );
    expect(page.querySelector('[data-switch-help]')).toBeNull();
    expect(text(page.querySelector('[data-ratio-heading]'))).toBe('60/40');
    expect(page.querySelectorAll('[data-shared]')).toHaveLength(1);
  });

  it('still shows the settlement when the shares cannot be fetched', async () => {
    sharesStore.failed.set(true);
    const { page } = await render({
      settlement: settlementOf({ balance: 312 }),
      ratio: undefined,
      shares: undefined,
    });

    expect(text(page.querySelector('[data-balance]'))).toBe('312,00 kr');
    expect(text(page.querySelector('[data-ratio-card] [role=alert]'))).toContain(
      'kunde inte hämtas',
    );
    expect(text(page.querySelector('[data-shared-card] [role=alert]'))).toContain(
      'kunde inte hämtas',
    );
  });

  describe('the settlement balance', () => {
    it('explains the switch from the spreadsheet before the first balance setting', async () => {
      const { page } = await render();

      expect(text(page.querySelector('[data-switch-help]'))).toContain(
        'partnerns andel av det som redan är betalt, per idag',
      );
      expect(page.querySelector('[data-balance]')).toBeNull();
    });

    it('shows what the partner owes, and since when', async () => {
      const { page } = await render({
        settlement: settlementOf({
          balance: 312,
          periods: [
            period({
              payments: [
                { transactionId: 1, date: '2026-10-20', description: 'Swish', amount: 10 },
              ],
            }),
          ],
        }),
      });

      expect(text(page.querySelector('[data-balance]'))).toBe('312,00 kr');
      expect(text(page.querySelector('[data-balance-direction]'))).toBe(
        'Partnern är skyldig dig · sedan avräkningen 20 okt',
      );
    });

    it('says the owner owes the partner when the balance is negative', async () => {
      const { page } = await render({ settlement: settlementOf({ balance: -312 }) });

      expect(text(page.querySelector('[data-balance]'))).toBe('312,00 kr');
      expect(text(page.querySelector('[data-balance-direction]'))).toContain(
        'Du är skyldig partnern',
      );
    });

    it('sets the balance from a form that opens inline, per today by default', async () => {
      const { fixture, page } = await render();
      expect(document.querySelector('[data-setting-form]')).toBeNull();

      page.querySelector<HTMLButtonElement>('[data-open-setting]')!.click();
      await fixture.whenStable();
      expect(document.querySelector('[data-as-of] [data-date-text]')!.textContent!.trim()).toBe(
        today,
      );
      expect(text(document.querySelector('[data-setting-form] .field-suffix'))).toBe('kr');
      type(document.querySelector<HTMLInputElement>('[data-amount]')!, '1 200,50'.replace(' ', ''));
      await fixture.whenStable();
      document.querySelector<HTMLButtonElement>('[data-save-balance]')!.click();

      expect(callsTo(settlementStore, 'setBalance')).toEqual([[{ amount: 1200.5, asOf: today }]]);
      // The settlement fact refreshes what the page shows.
      settlementStore.settlement.set(settlementOf({ balance: 1200.5 }));
      await fixture.whenStable();

      expect(text(page.querySelector('[data-balance]'))).toBe('1 200,50 kr');
      expect(document.querySelector('[data-setting-form]')).toBeNull();
    });
  });

  describe('the periods', () => {
    const settlement = settlementOf({
      balance: 80,
      periods: [
        period({
          carriedIn: 50,
          carriedOut: 80,
          items: [
            {
              transactionId: 7,
              date: '2026-11-12',
              description: 'ICA',
              accountName: 'Coop',
              amount: -60,
              share: 'half',
              partnerPart: 30,
              ownerPercent: 50,
              category: null,
              subcategory: null,
              paidBy: 'owner',
              status: 'booked',
              icon: 'shopping-basket',
              colour: 'green',
            },
            {
              transactionId: 8,
              date: '2026-11-13',
              description: 'Återbetalning',
              accountName: 'Coop',
              amount: 200,
              share: 'half',
              partnerPart: -100,
              ownerPercent: 50,
              category: null,
              subcategory: null,
              paidBy: 'owner',
              status: 'booked',
              icon: null,
              colour: null,
            },
          ],
        }),
        period({
          month: '2026-10',
          closedThrough: '2026-11-02',
          carriedIn: 50,
          paid: 200,
          payments: [{ transactionId: 5, date: '2026-11-02', description: 'Swish', amount: 200 }],
          carriedOut: 50,
        }),
      ],
    });

    it('shows the open period with ingående, one row per transaction and utgående', async () => {
      const { page } = await render({ settlement });

      const open = page.querySelector('[data-open-period]')!;
      expect(text(open.querySelector('h2'))).toBe('November 2026 · pågående');
      expect(text(open.querySelector('[data-carried-in]'))).toBe('50,00 kr');
      expect([...open.querySelectorAll('[data-item]')].map((i) => text(i))).toEqual([
        expect.stringContaining('ICA'),
        expect.stringContaining('Återbetalning'),
      ]);
      expect(text(open.querySelector('[data-item]'))).toContain('12 nov');
      expect(text(open.querySelector('[data-item]'))).toContain('50/50');
      const parts = open.querySelectorAll('[data-partner-part]');
      expect(parts[0]?.classList.contains('text-danger')).toBe(false);
      expect(parts[1]?.classList.contains('text-danger')).toBe(true);
      expect(text(open.querySelector('[data-carried-out]'))).toBe('80,00 kr');
    });

    it('lists the transactions of a closed period on request', async () => {
      const item = {
        transactionId: 9,
        date: '2026-10-05',
        description: 'Hyra',
        accountName: 'Lönekonto',
        amount: -1000,
        share: 'half' as const,
        partnerPart: 500,
        ownerPercent: 50,
        category: null,
        subcategory: null,
        paidBy: 'owner' as const,
        status: 'booked' as const,
        icon: null,
        colour: null,
      };
      const { fixture, page } = await render({
        settlement: settlementOf({
          balance: 0,
          periods: [
            period(),
            period({ month: '2026-10', closedThrough: '2026-10-31', items: [item] }),
          ],
        }),
      });
      page
        .querySelector<HTMLButtonElement>('[data-toggle-closed] [data-disclosure-toggle]')!
        .click();
      await fixture.whenStable();
      const closed = page.querySelector('[data-closed-period]')!;
      expect(closed.querySelector('[data-item]')).toBeNull();

      closed
        .querySelector<HTMLButtonElement>('[data-toggle-items] [data-disclosure-toggle]')!
        .click();
      await fixture.whenStable();
      expect(text(closed.querySelector('[data-item]'))).toContain('Hyra');
      expect(text(closed.querySelector('[data-partner-part]'))).toBe('500,00 kr');

      closed
        .querySelector<HTMLButtonElement>('[data-toggle-items] [data-disclosure-toggle]')!
        .click();
      await fixture.whenStable();
      expect(closed.querySelector('[data-item]')).toBeNull();
    });

    it('expands the closed periods on request', async () => {
      const { fixture, page } = await render({ settlement });
      expect(page.querySelector('[data-closed-period]')).toBeNull();

      page
        .querySelector<HTMLButtonElement>('[data-toggle-closed] [data-disclosure-toggle]')!
        .click();
      await fixture.whenStable();

      const closed = page.querySelector('[data-closed-period]')!;
      expect(text(closed.querySelector('h2'))).toBe('Oktober 2026 · avslutad, t.o.m. 2 nov');
      expect(text(closed.querySelector('[data-carried-in]'))).toBe('50,00 kr');
      expect(text(closed.querySelector('[data-payment]'))).toBe('200,00 kr');
      expect(text(closed.querySelector('[data-carried-out]'))).toBe('50,00 kr');
    });
  });

  it('cancels the balance form and forgets what was typed', async () => {
    const { fixture, page } = await render();
    page.querySelector<HTMLButtonElement>('[data-open-setting]')!.click();
    await fixture.whenStable();
    type(document.querySelector<HTMLInputElement>('[data-amount]')!, '500');
    await fixture.whenStable();

    document.querySelector<HTMLButtonElement>('[data-cancel-setting]')!.click();
    await fixture.whenStable();
    expect(document.querySelector('[data-setting-form]')).toBeNull();
    page.querySelector<HTMLButtonElement>('[data-open-setting]')!.click();
    await fixture.whenStable();
    expect(document.querySelector<HTMLInputElement>('[data-amount]')!.value).toBe('');
  });

  describe('closing a month', () => {
    const settlement = settlementOf({
      balance: 80,
      periods: [
        period({
          month: '2026-10',
          carriedOut: 80,
          payments: [
            { transactionId: 5, date: '2026-10-14', description: 'Swish', amount: 100 },
            { transactionId: 6, date: '2026-10-28', description: 'Swish', amount: 100 },
          ],
        }),
      ],
    });

    it('puts the close in the balance card', async () => {
      const { page } = await render({ settlement });
      expect(page.querySelector('[data-balance-card] [data-close-month]')).not.toBeNull();
    });

    it('offers the day of the latest settlement and the next month by default', async () => {
      const { fixture, page } = await render({ settlement });
      expect(text(page.querySelector('[data-close-month]'))).toBe('Avsluta oktober');
      expect(text(page.querySelectorAll('[data-payment]')[1])).toContain('28 okt');

      page.querySelector<HTMLButtonElement>('[data-close-month]')!.click();
      await fixture.whenStable();

      expect(text(document.querySelector('[data-closing-date] [data-date-text]'))).toBe(
        '2026-10-28',
      );
      expect(text(document.querySelector('[data-next-month] [data-month-text]'))).toBe('2026-11');
    });

    it('defaults the closing date to today without a settlement', async () => {
      const { fixture, page } = await render({
        settlement: settlementOf({ balance: 0, periods: [period({ month: '2026-10' })] }),
      });
      page.querySelector<HTMLButtonElement>('[data-close-month]')!.click();
      await fixture.whenStable();
      expect(text(document.querySelector('[data-closing-date] [data-date-text]'))).toBe(today);
    });

    it('sends the close and shows the new periods', async () => {
      const { fixture, page } = await render({ settlement });
      page.querySelector<HTMLButtonElement>('[data-close-month]')!.click();
      await fixture.whenStable();
      pick(document.body, '[data-next-month]', '2026-12');
      await fixture.whenStable();
      document.querySelector<HTMLButtonElement>('[data-confirm-close]')!.click();

      expect(callsTo(settlementStore, 'close')).toEqual([
        [{ closedThrough: '2026-10-28', nextMonth: '2026-12' }],
      ]);
      settlementStore.settlement.set(
        settlementOf({
          balance: 80,
          periods: [
            period({ month: '2026-12', carriedIn: 80 }),
            period({ month: '2026-10', closedThrough: '2026-10-28' }),
          ],
        }),
      );
      await fixture.whenStable();

      expect(text(page.querySelector('[data-open-period] h2'))).toBe('December 2026 · pågående');
      expect(document.querySelector('[data-close-form]')).toBeNull();
    });

    it('does not accept a next month that is not later', async () => {
      const { fixture, page } = await render({ settlement });
      page.querySelector<HTMLButtonElement>('[data-close-month]')!.click();
      await fixture.whenStable();
      pick(document.body, '[data-next-month]', '2026-10');
      await fixture.whenStable();
      expect(document.querySelector<HTMLButtonElement>('[data-confirm-close]')!.disabled).toBe(
        true,
      );
    });

    it('edits the month of the open period', async () => {
      const { fixture, page } = await render({ settlement });
      await openMenu(fixture, page.querySelector('[data-open-period]')!);
      page.querySelector<HTMLButtonElement>('[data-edit-month]')!.click();
      await fixture.whenStable();
      pick(document.body, '[data-month-input]', '2026-09');
      await fixture.whenStable();
      document.querySelector<HTMLButtonElement>('[data-save-month]')!.click();
      expect(callsTo(settlementStore, 'setOpenMonth')).toEqual([[{ month: '2026-09' }]]);
      settlementStore.settlement.set(
        settlementOf({ balance: 80, periods: [period({ month: '2026-09' })] }),
      );
      await fixture.whenStable();
      expect(text(page.querySelector('[data-open-period] h2'))).toBe('September 2026 · pågående');
    });

    it('warns when the open month ended long ago', async () => {
      const { page } = await render({
        settlement: settlementOf({
          balance: 0,
          periods: [period({ month: '2026-10', overdue: true })],
        }),
      });
      expect(text(page.querySelector('[data-overdue]'))).toBe('Oktober är inte avslutad');
    });

    it('shows no warning otherwise', async () => {
      const { page } = await render({ settlement });
      expect(page.querySelector('[data-overdue]')).toBeNull();
    });

    describe('the report', () => {
      const opened = async (reportSaved: boolean) => {
        const rendered = await render({
          settlement: settlementOf({
            periods: [
              period({ month: '2026-11' }),
              period({ month: '2026-10', closedThrough: '2026-10-31', reportSaved }),
            ],
          }),
        });
        rendered.page
          .querySelector<HTMLButtonElement>('[data-toggle-closed] [data-disclosure-toggle]')!
          .click();
        await rendered.fixture.whenStable();
        return rendered;
      };

      it('shows no notice when it is saved', async () => {
        const { page } = await opened(true);
        expect(page.querySelector('[data-report-failed]')).toBeNull();
        expect(page.querySelector('[data-closed-period] [data-menu-trigger]')).not.toBeNull();
      });

      it('can be saved again, which clears the notice', async () => {
        const { fixture, page } = await opened(false);
        expect(text(page.querySelector('[data-report-failed]'))).toBe(
          'Rapporten kunde inte sparas',
        );

        await openMenu(fixture, page.querySelector('[data-closed-period]')!);
        page.querySelector<HTMLButtonElement>('[data-save-report]')!.click();
        expect(callsTo(settlementStore, 'saveReport')).toEqual([['2026-10']]);
        settlementStore.settlement.set(
          settlementOf({
            periods: [
              period({ month: '2026-11' }),
              period({ month: '2026-10', closedThrough: '2026-10-31', reportSaved: true }),
            ],
          }),
        );
        await fixture.whenStable();
        expect(page.querySelector('[data-report-failed]')).toBeNull();
      });
    });

    describe('undoing', () => {
      const closedTwice = settlementOf({
        balance: 0,
        periods: [
          period({ month: '2026-12' }),
          period({ month: '2026-11', closedThrough: '2026-11-30' }),
          period({ month: '2026-10', closedThrough: '2026-10-31' }),
        ],
      });

      it('offers it on the latest close only, after confirmation', async () => {
        const { fixture, page } = await render({ settlement: closedTwice });
        page
          .querySelector<HTMLButtonElement>('[data-toggle-closed] [data-disclosure-toggle]')!
          .click();
        await fixture.whenStable();
        for (const section of page.querySelectorAll('[data-closed-period]')) {
          await openMenu(fixture, section);
        }
        const buttons = page.querySelectorAll('[data-undo-close]');
        expect(buttons).toHaveLength(1);
        expect(text(buttons[0])).toBe('Ångra avslut…');

        (buttons[0] as HTMLButtonElement).click();
        await fixture.whenStable();
        expect(callsTo(settlementStore, 'undoClose')).toHaveLength(0);
        expect(text(document.querySelector('[role=alertdialog] [data-title]'))).toBe(
          'Ångra avslutet av November 2026?',
        );
        (document.querySelector('[role=alertdialog] [data-confirm]') as HTMLButtonElement).click();
        expect(callsTo(settlementStore, 'undoClose')).toHaveLength(1);
        settlementStore.settlement.set(
          settlementOf({
            periods: [
              period({ month: '2026-11' }),
              period({ month: '2026-10', closedThrough: '2026-10-31' }),
            ],
          }),
        );
        await fixture.whenStable();
        expect(text(page.querySelector('[data-open-period] h2'))).toBe('November 2026 · pågående');
        expect(document.querySelector('[role=alertdialog]')).toBeNull();
      });

      it('does nothing when cancelled', async () => {
        const { fixture, page } = await render({ settlement: closedTwice });
        page
          .querySelector<HTMLButtonElement>('[data-toggle-closed] [data-disclosure-toggle]')!
          .click();
        await fixture.whenStable();
        await openMenu(fixture, page.querySelector('[data-closed-period]')!);
        page.querySelector<HTMLButtonElement>('[data-undo-close]')!.click();
        await fixture.whenStable();
        (document.querySelector('[role=alertdialog] [data-cancel]') as HTMLButtonElement).click();
        await fixture.whenStable();
        expect(document.querySelector('[role=alertdialog]')).toBeNull();
        expect(callsTo(settlementStore, 'undoClose')).toHaveLength(0);
      });
    });
  });

  describe('the household ratio', () => {
    it('shows the ratio in force today, large, with the entry in force first in the history', async () => {
      const { page } = await render({
        ratio: [
          { from: '2026-01-01', percent: 60 },
          { from: '2026-07-01', percent: 55 },
          { from: '2999-01-01', percent: 50 },
        ],
      });

      expect(text(page.querySelector('[data-ratio-heading]'))).toBe('55/45');
      expect([...page.querySelectorAll('[data-ratio-entry]')].map((e) => text(e))).toEqual([
        expect.stringContaining('55/45'),
        expect.stringContaining('1 jan 2999'),
        expect.stringContaining('1 jan'),
      ]);
    });

    it('says none is set before the first entry', async () => {
      const { page } = await render({ ratio: [], shares: [] });

      expect(text(page.querySelector('[data-ratio-heading]'))).toContain('Ingen');
    });

    it('reveals what a change means and saves a dated entry from today', async () => {
      const { fixture, page } = await render();
      const slider = page.querySelector<HTMLInputElement>('[data-slider]')!;
      expect(slider.min).toBe('1');
      expect(slider.max).toBe('99');
      expect(slider.value).toBe('60');
      expect(page.querySelector('[data-slider-note]')).toBeNull();

      type(slider, '50');
      await fixture.whenStable();
      expect(text(page.querySelector('[data-ratio-heading]'))).toBe('50/50');
      expect(text(page.querySelector('[data-slider-note]'))).toBe(
        `Gäller från ${today}. Tidigare månader ändras inte.`,
      );
      page.querySelector<HTMLButtonElement>('[data-save-slider]')!.click();

      const entries = [
        { from: '2026-01-01', percent: 60 },
        { from: today, percent: 50 },
      ];
      expect(callsTo(sharesStore, 'setHouseholdRatio')).toEqual([[entries]]);
      // The shares fact refreshes what the page shows.
      sharesStore.householdRatio.set(entries);
      await fixture.whenStable();

      expect(text(page.querySelector('[data-ratio-heading]'))).toBe('50/50');
      expect(page.querySelector('[data-slider-note]')).toBeNull();
    });

    it('shows the balance the settlement read gives after the ratio changes', async () => {
      const { fixture, page } = await render({
        settlement: settlementOf({ balance: 100 }),
      });

      type(page.querySelector<HTMLInputElement>('[data-slider]')!, '50');
      await fixture.whenStable();
      page.querySelector<HTMLButtonElement>('[data-save-slider]')!.click();
      // The shares fact refreshes the settlement as well.
      settlementStore.settlement.set(settlementOf({ balance: 250 }));
      await fixture.whenStable();

      expect(text(page.querySelector('[data-balance]'))).toBe('250,00 kr');
    });

    it('replaces an entry that starts today instead of duplicating it', async () => {
      const { fixture, page } = await render({
        ratio: [{ from: today, percent: 60 }],
      });

      type(page.querySelector<HTMLInputElement>('[data-slider]')!, '70');
      await fixture.whenStable();
      page.querySelector<HTMLButtonElement>('[data-save-slider]')!.click();

      expect(callsTo(sharesStore, 'setHouseholdRatio')).toEqual([[[{ from: today, percent: 70 }]]]);
    });

    it('edits a past entry', async () => {
      const { fixture, page } = await render({
        ratio: [
          { from: '2026-01-01', percent: 60 },
          { from: '2026-07-01', percent: 55 },
        ],
      });

      const entries = page.querySelectorAll('[data-ratio-entry]');
      await openMenu(fixture, entries[1]!);
      entries[1]!.querySelector<HTMLButtonElement>('[data-edit]')!.click();
      await fixture.whenStable();
      type(document.querySelector<HTMLInputElement>('[data-edit-percent]')!, '65');
      document.querySelector<HTMLButtonElement>('[data-save-edit]')!.click();

      expect(callsTo(sharesStore, 'setHouseholdRatio')).toEqual([
        [
          [
            { from: '2026-01-01', percent: 65 },
            { from: '2026-07-01', percent: 55 },
          ],
        ],
      ]);
    });

    it('does not send a percentage outside 1 to 99', async () => {
      const { fixture, page } = await render();

      await openMenu(fixture, page.querySelector('[data-ratio-entry]')!);
      page.querySelector<HTMLButtonElement>('[data-edit]')!.click();
      await fixture.whenStable();
      type(document.querySelector<HTMLInputElement>('[data-edit-percent]')!, '100');
      document.querySelector<HTMLButtonElement>('[data-save-edit]')!.click();
      await fixture.whenStable();

      expect(text(document.querySelector('[data-ratio-form] [role=alert]'))).toContain('1 och 99');
    });

    it('removes an entry, but never the last one', async () => {
      const { fixture, page } = await render({
        ratio: [
          { from: '2026-01-01', percent: 60 },
          { from: '2026-07-01', percent: 55 },
        ],
      });

      const entries = page.querySelectorAll('[data-ratio-entry]');
      await openMenu(fixture, entries[1]!);
      entries[1]!.querySelector<HTMLButtonElement>('[data-remove]')!.click();
      await fixture.whenStable();
      expect(callsTo(sharesStore, 'setHouseholdRatio')).toHaveLength(0);
      (document.querySelector('[role=alertdialog] [data-confirm]') as HTMLButtonElement).click();
      expect(callsTo(sharesStore, 'setHouseholdRatio')).toEqual([
        [[{ from: '2026-07-01', percent: 55 }]],
      ]);
      sharesStore.householdRatio.set([{ from: '2026-07-01', percent: 55 }]);
      await fixture.whenStable();

      await openMenu(fixture, page.querySelector('[data-ratio-entry]')!);
      expect(page.querySelector<HTMLButtonElement>('[data-remove]')!.disabled).toBe(true);
    });
  });

  describe('the shared subcategories', () => {
    const rows = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>('[data-shared]')];
    const pressed = (row: Element) =>
      row.querySelector('[aria-pressed=true]')?.getAttribute('data-share');

    it('lists only the subcategories that are not Jag, with a note about the rest', async () => {
      const { page } = await render({
        shares: [
          { subcategoryId: 10, share: 'household' },
          { subcategoryId: 20, share: 'partner' },
        ],
      });

      expect(rows(page).map((r) => [text(r.querySelector('[data-name]')), pressed(r)])).toEqual([
        ['Bolån', 'household'],
        ['Restaurang', 'partner'],
      ]);
      expect(text(page.querySelector('[data-shared-card]'))).toContain(
        'Alla andra underkategorier räknas som Jag (100 %). Ett kontos eller en transaktions egen andel går före.',
      );
    });

    it('offers Jag, 50/50, Hushåll and Partner', async () => {
      const { page } = await render();

      expect(
        [...rows(page)[0]!.querySelectorAll('button[data-share]')].map((b) => text(b)),
      ).toEqual(['Jag', '50/50', 'Hushåll', 'Partner']);
    });

    it('adds a subcategory at 50/50 from the picker, changes it and removes it', async () => {
      const { fixture, page } = await render();
      const toast = TestBed.inject(ToastService);

      page.querySelector<HTMLButtonElement>('[data-add-shared]')!.click();
      await fixture.whenStable();
      // Only subcategories that are still Jag are offered.
      expect(page.querySelectorAll('[data-picker-category]').length).toBe(2);
      page.querySelector<HTMLButtonElement>('[data-category-tile="2"]')!.click();
      await fixture.whenStable();
      page.querySelector<HTMLButtonElement>('[data-subcategory="20"]')!.click();
      expect(callsTo(sharesStore, 'setSubcategoryShare')).toEqual([[20, 'half']]);
      sharesStore.subcategoryShares.set([
        { subcategoryId: 10, share: 'household' },
        { subcategoryId: 20, share: 'half' },
      ]);
      await fixture.whenStable();
      expect(rows(page).map((r) => [text(r.querySelector('[data-name]')), pressed(r)])).toEqual([
        ['Bolån', 'household'],
        ['Restaurang', 'half'],
      ]);
      expect(page.querySelector('[data-picker]')).toBeNull();

      rows(page)[1]!.querySelector<HTMLButtonElement>('[data-share=household]')!.click();
      expect(callsTo(sharesStore, 'setSubcategoryShare').at(-1)).toEqual([20, 'household']);
      sharesStore.subcategoryShares.set([
        { subcategoryId: 10, share: 'household' },
        { subcategoryId: 20, share: 'household' },
      ]);
      await fixture.whenStable();
      expect(pressed(rows(page)[1]!)).toBe('household');

      rows(page)[1]!.querySelector<HTMLButtonElement>('[data-share=me]')!.click();
      expect(callsTo(sharesStore, 'setSubcategoryShare').at(-1)).toEqual([20, 'me']);
      sharesStore.subcategoryShares.set([{ subcategoryId: 10, share: 'household' }]);
      await fixture.whenStable();
      expect(rows(page).length).toBe(1);
      expect(toast.message()).toContain('Restaurang');
    });

    it('does not offer a subcategory that is already shared', async () => {
      const { fixture, page } = await render();

      page.querySelector<HTMLButtonElement>('[data-add-shared]')!.click();
      await fixture.whenStable();
      page.querySelector<HTMLButtonElement>('[data-category-tile="1"]')!.click();
      await fixture.whenStable();

      expect(
        [...page.querySelectorAll('[data-picker-subcategories] [data-subcategory]')].map((b) =>
          text(b),
        ),
      ).toEqual(['Bredband']);
    });

    it('says why when Hushåll is refused', async () => {
      const { fixture, page } = await render({ ratio: [], shares: [] });
      sharesStore.failures['setSubcategoryShare'] = { status: 409 };
      page.querySelector<HTMLButtonElement>('[data-add-shared]')!.click();
      await fixture.whenStable();
      page.querySelector<HTMLButtonElement>('[data-category-tile="2"]')!.click();
      await fixture.whenStable();
      page.querySelector<HTMLButtonElement>('[data-subcategory="20"]')!.click();
      await fixture.whenStable();

      expect(text(page.querySelector('[role=alert]'))).toContain('hushållsandel');
      expect(rows(page).length).toBe(0);
    });
  });
});
