import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type {
  LoanPart,
  MortgageFiguresResponse,
  MortgageMonth,
  MortgageResponse,
} from '@bankapp/shared';
import { type CategorisedSubcategory, CategoriesService } from '../../categories.service';
import { MortgageStore } from '../../stores/mortgage.store';
import { FakeMortgageStore } from '../../stores/mortgage.store.fake';
import { BolanPage } from './bolan.page';

const part = (id: number, name: string, extra: Partial<LoanPart> = {}): LoanPart => ({
  id,
  name,
  startedOn: '2026-01-10',
  endedOn: null,
  debt: 1000000,
  rate: 3.85,
  amortisation: 2500,
  rateChanges: [],
  amortisationChanges: [],
  rateAdjustment: { next: '2027-02-20', intervalMonths: 3 },
  termsChange: { next: '2027-03-01', intervalMonths: 12 },
  ...extra,
});

const MORTGAGE: MortgageResponse = {
  parts: [part(1, 'Del 1'), part(2, 'Del 2', { debt: 500000, rate: 4.1 })],
  entries: [
    {
      id: 9,
      date: '2026-01-10',
      debts: [
        { partId: 1, debt: 1000000 },
        { partId: 2, debt: 500000 },
      ],
    },
  ],
};

const month = (m: string, extra: Partial<MortgageMonth> = {}): MortgageMonth => ({
  month: m,
  debts: [
    { partId: 1, debt: 1000000 },
    { partId: 2, debt: 500000 },
  ],
  interest: 5000,
  amortisation: 2500,
  total: 7500,
  paid: 7500,
  ...extra,
});

const FIGURES: MortgageFiguresResponse = {
  debts: [
    { partId: 1, debt: 990000 },
    { partId: 2, debt: 500000 },
  ],
  months: [month('2026-10'), month('2026-11', { interest: 4800, amortisation: 2000, total: 6800 })],
  monthsWithoutPayment: [],
};

const SUBCATEGORIES = [
  {
    category: { id: 1, name: 'Boende & Hushåll' },
    subcategory: { id: 42, name: 'Bolån ränta & amortering' },
  },
] as unknown as CategorisedSubcategory[];

describe('BolanPage', () => {
  let store: FakeMortgageStore;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00'));
    store = new FakeMortgageStore();
    TestBed.configureTestingModule({
      providers: [
        { provide: MortgageStore, useValue: store },
        {
          provide: CategoriesService,
          useValue: { subcategories: () => of(SUBCATEGORIES) },
        },
        provideRouter([]),
      ],
    });
  });
  afterEach(() => vi.useRealTimers());

  /** What the page sent to the store for a mutation, in order. */
  const sent = (method: string) =>
    store.calls.filter((c) => c.method === method).map((c) => c.args);

  async function render(
    mortgage: MortgageResponse = MORTGAGE,
    figures: MortgageFiguresResponse = FIGURES,
  ) {
    store.mortgageAnswer.set(mortgage);
    store.figuresAnswer.set(figures);
    const fixture = TestBed.createComponent(BolanPage);
    await fixture.whenStable();
    // Sheets and confirmations open in <body>, outside the page.
    const root = document.body;
    const click = async (selector: string) => {
      root.querySelector<HTMLElement>(selector)!.click();
      await fixture.whenStable();
    };
    const type = async (selector: string, text: string) => {
      const input = root.querySelector<HTMLInputElement>(selector)!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    /** Opens the ⋯ menu of the first element matching `scope`. */
    const openMenu = (scope: string) => click(`${scope} [data-menu-trigger]`);
    return { fixture, root, click, type, openMenu };
  }

  it('shows each part with its rate, amortisation and next days', async () => {
    const { root } = await render();
    const first = root.querySelector('[data-part="1"]')!;
    expect(first.textContent).toContain('Del 1');
    expect(first.querySelector('[data-part-rate]')?.textContent).toContain('3,85');
    expect(first.querySelector('[data-part-debt]')?.textContent).toContain('990');
    expect(first.querySelector('[data-part-interest]')?.textContent).toContain('3');
    expect(first.querySelector('[data-rate-day]')?.textContent).toBe('20 feb 2027');
    expect(first.querySelector('[data-terms-day]')?.textContent).toBe('1 mars 2027');
  });

  it('offers setup before there is a mortgage', async () => {
    const { root } = await render(
      { parts: [], entries: [] },
      { debts: [], months: [], monthsWithoutPayment: [] },
    );
    expect(root.querySelector('[data-add-part]')?.textContent).toContain('Lägg till bolån');
    expect(root.querySelector('[data-intro]')).not.toBeNull();
    expect(root.querySelector('[data-summary]')).toBeNull();
    expect(root.querySelector('[data-chart-card]')).toBeNull();
    expect(root.querySelector('[data-new-entry]')).toBeNull();
  });

  it('sets up a part with Swedish-format numbers', async () => {
    const { root, click, type } = await render(
      { parts: [], entries: [] },
      { debts: [], months: [], monthsWithoutPayment: [] },
    );
    await click('[data-add-part]');
    await type('[data-part-form] [data-name]', 'Del 1 – 3 mån');
    await type('[data-part-form] [data-debt]', '1 000 000');
    await type('[data-part-form] [data-rate]', '3,85');
    await type('[data-part-form] [data-amortisation]', '2 500,50');
    await click('[data-save]');
    // The days are still empty, so nothing is sent.
    expect(root.querySelector('[data-form-error]')?.textContent).toContain('räntejusteringsdag');
    expect(sent('addPart')).toEqual([]);
  });

  it('has one menu per part instead of one button per action', async () => {
    const { root, openMenu } = await render();
    expect(root.querySelectorAll('[data-part="1"] button')).toHaveLength(1);
    await openMenu('[data-part="1"]');
    const items = Array.from(root.querySelectorAll('[data-part="1"] [role="menuitem"]'));
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Ändra',
      'Ny ränta',
      'Avsluta lånedel…',
    ]);
  });

  it('sends a new rate only when the rate was touched', async () => {
    const { click, type, openMenu } = await render();
    await openMenu('[data-part="1"]');
    await click('[data-part="1"] [data-edit]');
    await type('[data-part-panel] [data-rate]', '4,25');
    await click('[data-part-panel] [data-save]');
    expect(sent('updatePart')).toEqual([[1, expect.objectContaining({ name: 'Del 1' })]]);
    const [[id, request]] = sent('addRateChange') as [[number, { rate: number; from: string }]];
    expect(id).toBe(1);
    expect(request).toMatchObject({ rate: 4.25 });
    expect(request.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent('addAmortisationChange')).toEqual([]);
  });

  it('renames without recording a rate change', async () => {
    const { click, type, openMenu } = await render();
    await openMenu('[data-part="1"]');
    await click('[data-part="1"] [data-edit]');
    await type('[data-part-panel] [data-name]', 'Del A');
    await click('[data-part-panel] [data-save]');
    expect(sent('updatePart')).toEqual([[1, expect.objectContaining({ name: 'Del A' })]]);
    expect(sent('addRateChange')).toEqual([]);
  });

  it('refuses an interval of 0 when editing', async () => {
    const { root, click, type, openMenu } = await render();
    await openMenu('[data-part="1"]');
    await click('[data-part="1"] [data-edit]');
    await type('[data-part-panel] [data-rate-interval]', '0');
    await click('[data-part-panel] [data-save]');
    expect(root.querySelector('[data-form-error]')?.textContent).toContain('minst 1 månad');
    expect(sent('updatePart')).toEqual([]);
  });

  it('ends a part from its menu after confirming with a date', async () => {
    const { root, click, openMenu } = await render();
    await openMenu('[data-part="1"]');
    await click('[data-part="1"] [data-end]');
    expect(sent('endPart')).toEqual([]);
    expect(root.querySelector('[role=alertdialog] [data-end-date]')).not.toBeNull();
    await click('[role=alertdialog] [data-confirm]');
    const [[id, request]] = sent('endPart') as [[number, { date: string }]];
    expect(id).toBe(1);
    expect(request.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('prefills a new mortgage entry with the current debt of every open part', async () => {
    const { root, click } = await render({
      ...MORTGAGE,
      parts: [...MORTGAGE.parts, part(3, 'Del 0', { endedOn: '2026-06-01', debt: 0 })],
    });
    await click('[data-new-entry]');
    expect(root.querySelector<HTMLInputElement>('[data-entry-debt="1"]')?.value).toBe('1000000');
    expect(root.querySelector<HTMLInputElement>('[data-entry-debt="2"]')?.value).toBe('500000');
    expect(root.querySelector('[data-entry-debt="3"]')).toBeNull();
    await click('[data-entry-form] [data-save]');
    const [[request]] = sent('addEntry') as [[{ debts: unknown[] }]];
    expect(request.debts).toEqual([
      { partId: 1, debt: 1000000 },
      { partId: 2, debt: 500000 },
    ]);
  });

  it('deletes an entry after confirming', async () => {
    const { root, click, openMenu } = await render();
    await openMenu('[data-entry]');
    await click('[data-delete-entry]');
    expect(sent('deleteEntry')).toEqual([]);
    expect(root.querySelector('[role=alertdialog] [data-title]')?.textContent).toContain(
      'Ta bort bolånenoteringen?',
    );
    await click('[role=alertdialog] [data-confirm]');
    expect(sent('deleteEntry')).toEqual([[9]]);
  });

  it('shows the totals from the figures', async () => {
    const { root } = await render();
    const text = (selector: string) =>
      root.querySelector(selector)?.textContent?.replace(/\s/g, ' ');
    expect(text('[data-total-debt]')).toContain('1 490 000');
    // (990 000 × 3,85 + 500 000 × 4,1) / 1 490 000
    expect(text('[data-average-rate]')).toContain('3,93');
    expect(text('[data-estimate]')).toContain('6 800');
    expect(text('[data-estimate-interest]')).toContain('4 800');
    expect(text('[data-estimate-amortisation]')).toContain('2 000');
  });

  describe('dates', () => {
    const withDays = (rate: string, terms: string, extra: Partial<LoanPart> = {}) => ({
      ...MORTGAGE,
      parts: [
        part(1, 'Del 1', {
          rateAdjustment: { next: rate, intervalMonths: 3 },
          termsChange: { next: terms, intervalMonths: 12 },
          ...extra,
        }),
      ],
    });

    it('always shows both dates but highlights them only from 14 days before', async () => {
      const { root } = await render(withDays('2026-11-29', '2026-12-01'));
      expect(root.querySelector('[data-rate-soon]')?.textContent).toBe('om 14 dagar');
      expect(root.querySelector('[data-terms-soon]')).toBeNull();
      expect(root.querySelector('[data-terms-day]')?.textContent).toBe('1 dec');
      expect(root.querySelector('[data-rate-day]')?.classList).toContain('text-accent');
      expect(root.querySelector('[data-terms-day]')?.classList).not.toContain('text-accent');
    });

    it('says imorgon and idag', async () => {
      const { root } = await render(withDays('2026-11-16', '2026-11-15'));
      expect(root.querySelector('[data-rate-soon]')?.textContent).toBe('imorgon');
      expect(root.querySelector('[data-terms-soon]')?.textContent).toBe('idag');
    });

    it('does not warn: no warning sign', async () => {
      const { root } = await render(withDays('2026-11-16', '2026-11-15'));
      expect(root.querySelector('[data-part="1"]')?.textContent).not.toContain('⚠');
    });
  });

  describe('rate prompt', () => {
    const due = (extra: Partial<LoanPart> = {}) => ({
      ...MORTGAGE,
      parts: [
        part(1, 'Del 1', { rateAdjustment: { next: '2026-11-15', intervalMonths: 3 }, ...extra }),
      ],
    });

    it('asks on the rate adjustment day', async () => {
      const { root } = await render(due());
      expect(root.querySelector('[data-rate-prompt]')?.textContent).toContain(
        'Dags att ange ny ränta för Del 1',
      );
    });

    it('keeps asking after the day until a rate change on or after it exists', async () => {
      // Next is 2027-01-10, so the day that passed was 2026-10-10.
      const next = { next: '2027-01-10', intervalMonths: 3 };
      const open = await render(due({ rateAdjustment: next }));
      expect(open.root.querySelector('[data-rate-prompt]')).not.toBeNull();
    });

    it('clears once a rate change is dated on or after the day', async () => {
      const next = { next: '2027-01-10', intervalMonths: 3 };
      const { root } = await render(
        due({
          rateAdjustment: next,
          rateChanges: [{ id: 1, from: '2026-10-10', rate: 3.85 }],
        }),
      );
      expect(root.querySelector('[data-rate-prompt]')).toBeNull();
    });

    it('is not shown before the first adjustment day of a new part', async () => {
      const { root } = await render(
        due({
          startedOn: '2026-11-01',
          rateChanges: [{ id: 1, from: '2026-11-01', rate: 3.85 }],
          rateAdjustment: { next: '2027-02-01', intervalMonths: 3 },
        }),
      );
      expect(root.querySelector('[data-rate-prompt]')).toBeNull();
    });

    it('records the same rate again, which clears it', async () => {
      const { root, click } = await render(due());
      await click('[data-new-rate]');
      expect(root.querySelector<HTMLInputElement>('[data-new-rate-form] [data-rate]')?.value).toBe(
        '3,85',
      );
      await click('[data-new-rate-form] [data-save]');
      expect(sent('addRateChange')).toEqual([
        [1, expect.objectContaining({ rate: 3.85, from: '2026-11-15' })],
      ]);
    });
  });

  describe('months without a payment', () => {
    it('notes it, with a link per month to the filtered transactions', async () => {
      const { root, click } = await render(MORTGAGE, {
        ...FIGURES,
        monthsWithoutPayment: ['2026-09'],
      });
      const note = root.querySelector('[data-no-payment]')!;
      expect(note.textContent).toContain('Ingen bolånebetalning hittad i 1 månad');
      expect(note.querySelector('a')).toBeNull();
      await click('[data-no-payment-toggle]');
      expect(note.textContent).toContain('september');
      const href = note.querySelector('a')!.getAttribute('href')!;
      expect(href).toContain('/transaktioner');
      expect(href).toContain('from=2026-09-01');
      expect(href).toContain('to=2026-09-30');
      expect(href).toContain('subcategories=42');
    });

    it('collapses several months into one notice', async () => {
      const { root, click } = await render(MORTGAGE, {
        ...FIGURES,
        monthsWithoutPayment: ['2026-07', '2026-08', '2026-09'],
      });
      expect(root.querySelectorAll('[data-no-payment]')).toHaveLength(1);
      expect(root.querySelector('[data-no-payment]')?.textContent).toContain(
        'Ingen bolånebetalning hittad i 3 månader',
      );
      await click('[data-no-payment-toggle]');
      expect(root.querySelectorAll('[data-no-payment-link]')).toHaveLength(3);
    });

    it('shows nothing when every month was paid', async () => {
      const { root } = await render();
      expect(root.querySelector('[data-no-payment]')).toBeNull();
    });
  });

  describe('chart', () => {
    const many = (count: number): MortgageFiguresResponse => ({
      ...FIGURES,
      months: Array.from({ length: count }, (_, i) =>
        month(`${2025 + Math.floor((i + 8) / 12)}-${String(((i + 8) % 12) + 1).padStart(2, '0')}`),
      ),
    });

    it('stacks the debt by part, then switches to Beräknat vs Betalt', async () => {
      const { root, click } = await render();
      expect(root.querySelector('[data-chart-card] h2')?.textContent).toContain(
        'Kvarvarande skuld',
      );
      // Two months, one segment per part each.
      expect(root.querySelectorAll('[data-bar]')).toHaveLength(4);
      await click('[data-mode="paid"]');
      expect(root.querySelector('[data-chart-card] h2')?.textContent).toContain(
        'Beräknat vs Betalt',
      );
      // Two months, two bars each.
      expect(root.querySelectorAll('[data-bar]')).toHaveLength(4);
      expect(root.querySelectorAll('[data-bar][data-series="paid"]')).toHaveLength(2);
    });

    it('shows the latest year by default and every month under Allt', async () => {
      const { root, click } = await render(MORTGAGE, many(20));
      expect(root.querySelectorAll('[data-chart-column]')).toHaveLength(12);
      await click('[data-range="all"]');
      expect(root.querySelectorAll('[data-chart-column]')).toHaveLength(20);
      await click('[data-range="1y"]');
      expect(root.querySelectorAll('[data-chart-column]')).toHaveLength(12);
    });

    it('tells the month in a tooltip', async () => {
      const { fixture, root } = await render();
      root.querySelector('[data-chart-column="2026-11"]')!.dispatchEvent(new Event('pointerenter'));
      await fixture.whenStable();
      const tooltip = root.querySelector('[data-chart-tooltip]')!;
      expect(tooltip.textContent).toContain('november 2026');
      expect(tooltip.textContent).toContain('Del 1');
    });
  });

  it('puts ended parts in a collapsed group', async () => {
    const { root, click } = await render({
      ...MORTGAGE,
      parts: [...MORTGAGE.parts, part(3, 'Del 0', { endedOn: '2026-06-01', debt: 0 })],
    });
    const group = root.querySelector<HTMLElement>('[data-ended-parts]')!;
    const toggle = group.querySelector<HTMLButtonElement>('[data-disclosure-toggle]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Avslutade lånedelar');
    expect(group.querySelector('[data-part="3"]')).toBeNull();
    await click('[data-ended-parts] [data-disclosure-toggle]');
    expect(group.querySelector('[data-part="3"]')).not.toBeNull();
  });

  it('shows the figures a change leads to without reloading', async () => {
    const { fixture, root, click, openMenu } = await render();
    await openMenu('[data-entry]');
    await click('[data-delete-entry]');
    await click('[role=alertdialog] [data-confirm]');
    // The store refreshes its reads after the mutation; the page just follows them.
    store.mortgageAnswer.set({ ...MORTGAGE, entries: [] });
    store.figuresAnswer.set({ ...FIGURES, debts: [{ partId: 1, debt: 900000 }] });
    await fixture.whenStable();
    expect(root.querySelector('[data-entry]')).toBeNull();
    expect(root.querySelector('[data-part="1"] [data-part-debt]')?.textContent).toContain('900');
  });

  it('says so when the mortgage cannot be fetched', async () => {
    store.mortgageAnswer.set('error');
    const fixture = TestBed.createComponent(BolanPage);
    await fixture.whenStable();
    expect(document.body.textContent).toContain('Bolånet kunde inte hämtas');
  });
});
