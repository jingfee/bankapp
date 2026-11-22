import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { LoanPart, MortgageResponse } from '@bankapp/shared';
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
  rateAdjustment: { next: '2027-02-15', intervalMonths: 3 },
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

describe('BolanPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function render(mortgage: MortgageResponse = MORTGAGE) {
    const fixture = TestBed.createComponent(BolanPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/mortgage').flush(mortgage);
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
    expect(first.querySelector('[data-rate-day]')?.textContent).toBe('2027-02-15');
    expect(first.querySelector('[data-terms-day]')?.textContent).toBe('2027-03-01');
  });

  it('offers setup before there is a mortgage', async () => {
    const { root } = await render({ parts: [], entries: [] });
    expect(root.querySelector('[data-add-part]')?.textContent).toContain('Ställ in bolånet');
    expect(root.querySelector('[data-new-entry]')).toBeNull();
  });

  it('sets up a part with Swedish-format numbers', async () => {
    const { http, root, click, type } = await render({ parts: [], entries: [] });
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
});
