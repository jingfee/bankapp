import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  Category,
  LoanPart,
  MortgageFiguresResponse,
  MortgageMonth,
  MortgageResponse,
} from '@bankapp/shared';
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

const CATEGORIES = [
  {
    id: 1,
    name: 'Boende & Hushåll',
    subcategories: [{ id: 42, name: 'Bolån ränta & amortering' }],
  },
] as unknown as Category[];

const FIGURES_URL = '/api/mortgage/figures';

describe('BolanPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00'));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });
  afterEach(() => {
    const http = TestBed.inject(HttpTestingController);
    // Every change reloads the figures; these tests only look at the calls they care about.
    http.match(FIGURES_URL);
    http.verify();
    vi.useRealTimers();
  });

  async function render(
    mortgage: MortgageResponse = MORTGAGE,
    figures: MortgageFiguresResponse = FIGURES,
  ) {
    const fixture = TestBed.createComponent(BolanPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/mortgage').flush(mortgage);
    http.expectOne(FIGURES_URL).flush(figures);
    http.expectOne('/api/categories').flush({ categories: CATEGORIES });
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
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
    return { fixture, http, root, click, type };
  }

  it('shows each part with its rate, amortisation and next days', async () => {
    const { root } = await render();
    const first = root.querySelector('[data-part="1"]')!;
    expect(first.textContent).toContain('Del 1');
    expect(first.querySelector('[data-part-rate]')?.textContent).toContain('3,85');
    expect(first.querySelector('[data-part-debt]')?.textContent).toContain('990');
    expect(first.querySelector('[data-part-interest]')?.textContent).toContain('3');
    expect(first.querySelector('[data-rate-day]')?.textContent).toBe('2027-02-20');
    expect(first.querySelector('[data-terms-day]')?.textContent).toBe('2027-03-01');
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
    const { http, root, click, type } = await render(
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
    http.expectNone('/api/mortgage/parts');
  });

  it('has one Ändra button per part instead of one per action', async () => {
    const { root } = await render();
    expect(root.querySelectorAll('[data-part="1"] button')).toHaveLength(1);
    expect(root.querySelector('[data-part="1"] [data-edit]')).not.toBeNull();
  });

  it('sends a new rate only when the rate was touched', async () => {
    const { http, click, type } = await render();
    await click('[data-part="1"] [data-edit]');
    await type('[data-part-panel] [data-rate]', '4,25');
    await click('[data-part-panel] [data-save]');
    const update = http.expectOne('/api/mortgage/parts/1');
    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toMatchObject({ name: 'Del 1' });
    update.flush(MORTGAGE);
    const request = http.expectOne('/api/mortgage/parts/1/rate-changes');
    expect(request.request.body).toMatchObject({ rate: 4.25 });
    expect(request.request.body.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    request.flush(MORTGAGE);
    http.expectNone('/api/mortgage/parts/1/amortisation-changes');
  });

  it('renames without recording a rate change', async () => {
    const { http, click, type } = await render();
    await click('[data-part="1"] [data-edit]');
    await type('[data-part-panel] [data-name]', 'Del A');
    await click('[data-part-panel] [data-save]');
    const update = http.expectOne('/api/mortgage/parts/1');
    expect(update.request.body).toMatchObject({ name: 'Del A' });
    update.flush(MORTGAGE);
    http.expectNone('/api/mortgage/parts/1/rate-changes');
  });

  it('refuses an interval of 0 when editing', async () => {
    const { http, root, click, type } = await render();
    await click('[data-part="1"] [data-edit]');
    await type('[data-part-panel] [data-rate-interval]', '0');
    await click('[data-part-panel] [data-save]');
    expect(root.querySelector('[data-form-error]')?.textContent).toContain('minst 1 månad');
    http.expectNone('/api/mortgage/parts/1');
  });

  it('ends a part from inside the edit form', async () => {
    const { http, click } = await render();
    await click('[data-part="1"] [data-edit]');
    await click('[data-part-panel] [data-end]');
    await click('[data-confirm-end]');
    const request = http.expectOne('/api/mortgage/parts/1/end');
    expect(request.request.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    request.flush(MORTGAGE);
  });

  it('prefills a new mortgage entry with the current debt of every open part', async () => {
    const { http, root, click } = await render({
      ...MORTGAGE,
      parts: [...MORTGAGE.parts, part(3, 'Del 0', { endedOn: '2026-06-01', debt: 0 })],
    });
    await click('[data-new-entry]');
    expect(root.querySelector<HTMLInputElement>('[data-entry-debt="1"]')?.value).toBe('1000000');
    expect(root.querySelector<HTMLInputElement>('[data-entry-debt="2"]')?.value).toBe('500000');
    expect(root.querySelector('[data-entry-debt="3"]')).toBeNull();
    await click('[data-entry-form] [data-save]');
    const request = http.expectOne('/api/mortgage/entries');
    expect(request.request.body.debts).toEqual([
      { partId: 1, debt: 1000000 },
      { partId: 2, debt: 500000 },
    ]);
    request.flush(MORTGAGE);
  });

  it('deletes an entry after confirming', async () => {
    const { http, click } = await render();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click('[data-delete-entry]');
    const request = http.expectOne('/api/mortgage/entries/9');
    expect(request.request.method).toBe('DELETE');
    request.flush({ ...MORTGAGE, entries: [] });
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
      expect(root.querySelector('[data-terms-day]')?.textContent).toBe('2026-12-01');
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
      const { http, root, click } = await render(due());
      await click('[data-new-rate]');
      expect(root.querySelector<HTMLInputElement>('[data-new-rate-form] [data-rate]')?.value).toBe(
        '3,85',
      );
      await click('[data-new-rate-form] [data-save]');
      const request = http.expectOne('/api/mortgage/parts/1/rate-changes');
      expect(request.request.body).toMatchObject({ rate: 3.85 });
      expect(request.request.body.from).toBe('2026-11-15');
      request.flush({
        ...MORTGAGE,
        parts: [part(1, 'Del 1', { rateChanges: [{ id: 2, from: '2026-11-15', rate: 3.85 }] })],
      });
    });
  });

  describe('months without a payment', () => {
    it('notes each one with a link to the filtered transactions', async () => {
      const { root } = await render(MORTGAGE, { ...FIGURES, monthsWithoutPayment: ['2026-09'] });
      const note = root.querySelector('[data-no-payment]')!;
      expect(note.textContent).toContain('Ingen bolånebetalning hittad i september');
      const href = note.querySelector('a')!.getAttribute('href')!;
      expect(href).toContain('/transaktioner');
      expect(href).toContain('from=2026-09-01');
      expect(href).toContain('to=2026-09-30');
      expect(href).toContain('subcategories=42');
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
      expect(root.querySelectorAll('[data-chart-month]')).toHaveLength(12);
      await click('[data-range="all"]');
      expect(root.querySelectorAll('[data-chart-month]')).toHaveLength(20);
      await click('[data-range="1y"]');
      expect(root.querySelectorAll('[data-chart-month]')).toHaveLength(12);
    });

    it('tells the month in a tooltip', async () => {
      const { fixture, root } = await render();
      root.querySelector('[data-chart-month="2026-11"]')!.dispatchEvent(new Event('pointerenter'));
      await fixture.whenStable();
      const tooltip = root.querySelector('[data-chart-tooltip]')!;
      expect(tooltip.textContent).toContain('november 2026');
      expect(tooltip.textContent).toContain('Del 1');
    });
  });

  it('puts ended parts in a collapsed group', async () => {
    const { root } = await render({
      ...MORTGAGE,
      parts: [...MORTGAGE.parts, part(3, 'Del 0', { endedOn: '2026-06-01', debt: 0 })],
    });
    const group = root.querySelector<HTMLDetailsElement>('[data-ended-parts]')!;
    expect(group.open).toBe(false);
    expect(group.querySelector('summary')?.textContent).toContain('Avslutade lånedelar');
    expect(group.querySelector('[data-part="3"]')).not.toBeNull();
    expect(root.querySelector('ul [data-part="3"]:not(details *)')).toBeNull();
  });

  it('reloads the figures after a change', async () => {
    const { http, click } = await render();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click('[data-delete-entry]');
    http.expectOne('/api/mortgage/entries/9').flush({ ...MORTGAGE, entries: [] });
    http.expectOne(FIGURES_URL).flush(FIGURES);
  });
});
