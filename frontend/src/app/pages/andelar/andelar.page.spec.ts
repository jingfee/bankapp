import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CategoriesResponse, HouseholdRatioEntry, SubcategoryShare } from '@bankapp/shared';
import { AndelarPage } from './andelar.page';

describe('AndelarPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AndelarPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

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
        subcategories: [{ id: 20, name: 'Livsmedel', icon: 'shopping-basket' }],
      },
    ],
  };

  const today = new Date().toLocaleDateString('sv-SE');

  async function render(
    ratio: HouseholdRatioEntry[] = [{ from: '2026-01-01', percent: 60 }],
    shares: SubcategoryShare[] = [{ subcategoryId: 10, share: 'household' }],
  ) {
    const fixture = TestBed.createComponent(AndelarPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/categories').flush(categories);
    http.expectOne('/api/subcategory-shares').flush({ shares });
    http.expectOne('/api/household-ratio').flush({ entries: ratio });
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement, http };
  }

  const rows = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>('[data-subcategory]')];
  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('lists every subcategory grouped by category with its share, Jag by default', async () => {
    const { page } = await render();

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Andelar');
    expect([...page.querySelectorAll('[data-category] h3')].map((h) => text(h))).toEqual([
      'Boende & Hushåll',
      'Mat & Dryck',
    ]);
    expect(
      rows(page).map((row) => [
        text(row.querySelector('[data-name]')),
        row.querySelector<HTMLSelectElement>('select')?.value,
      ]),
    ).toEqual([
      ['Bolån', 'household'],
      ['Bredband', 'me'],
      ['Livsmedel', 'me'],
    ]);
  });

  it('offers Jag, 50/50, Hushåll and Partner', async () => {
    const { page } = await render();

    const options = rows(page)[0]!.querySelectorAll('option');
    expect([...options].map((o) => [o.value, text(o)])).toEqual([
      ['me', 'Jag'],
      ['half', '50/50'],
      ['household', 'Hushåll'],
      ['partner', 'Partner'],
    ]);
  });

  it('marks the subcategories that are not Jag', async () => {
    const { page } = await render();

    expect(rows(page).map((row) => row.hasAttribute('data-shared'))).toEqual([true, false, false]);
  });

  it('saves a changed share and marks the row', async () => {
    const { fixture, page, http } = await render();
    const select = rows(page)[2]!.querySelector('select')!;

    select.value = 'half';
    select.dispatchEvent(new Event('change'));
    const put = http.expectOne('/api/subcategories/20/share');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ share: 'half' });
    put.flush(null);
    await fixture.whenStable();

    expect(rows(page)[2]!.hasAttribute('data-shared')).toBe(true);
  });

  it('puts the control back and says why when Hushåll is refused', async () => {
    const { fixture, page, http } = await render([], []);
    const select = rows(page)[1]!.querySelector('select')!;

    select.value = 'household';
    select.dispatchEvent(new Event('change'));
    http
      .expectOne('/api/subcategories/11/share')
      .flush({}, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();

    expect(select.value).toBe('me');
    expect(text(page.querySelector('[role=alert]'))).toContain('hushållsandel');
  });

  describe('the household ratio', () => {
    it('shows the ratio in force today as Hushåll (60/40) with its history', async () => {
      const { page } = await render([
        { from: '2026-01-01', percent: 60 },
        { from: '2026-07-01', percent: 55 },
        { from: '2999-01-01', percent: 50 },
      ]);

      expect(text(page.querySelector('[data-ratio-heading]'))).toBe('Hushåll (55/45)');
      expect([...page.querySelectorAll('[data-ratio-entry]')].map((e) => text(e))).toEqual([
        expect.stringContaining('2026-01-01'),
        expect.stringContaining('2026-07-01'),
        expect.stringContaining('2999-01-01'),
      ]);
    });

    it('says none is set before the first entry', async () => {
      const { page } = await render([], []);

      expect(text(page.querySelector('[data-ratio-heading]'))).toContain('Ingen');
    });

    it('adds an entry from a date, today by default', async () => {
      const { fixture, page, http } = await render();
      const from = page.querySelector<HTMLInputElement>('[data-add-from]')!;
      const percent = page.querySelector<HTMLInputElement>('[data-add-percent]')!;
      expect(from.value).toBe(today);

      percent.value = '50';
      percent.dispatchEvent(new Event('input'));
      page.querySelector<HTMLButtonElement>('[data-add-ratio]')!.click();
      const put = http.expectOne('/api/household-ratio');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({
        entries: [
          { from: '2026-01-01', percent: 60 },
          { from: today, percent: 50 },
        ],
      });
      put.flush({ entries: put.request.body.entries });
      await fixture.whenStable();

      expect(page.querySelectorAll('[data-ratio-entry]').length).toBe(2);
    });

    it('replaces an entry that starts on the same day instead of duplicating it', async () => {
      const { page, http } = await render();
      const from = page.querySelector<HTMLInputElement>('[data-add-from]')!;
      const percent = page.querySelector<HTMLInputElement>('[data-add-percent]')!;

      from.value = '2026-01-01';
      from.dispatchEvent(new Event('input'));
      percent.value = '70';
      percent.dispatchEvent(new Event('input'));
      page.querySelector<HTMLButtonElement>('[data-add-ratio]')!.click();

      expect(http.expectOne('/api/household-ratio').request.body).toEqual({
        entries: [{ from: '2026-01-01', percent: 70 }],
      });
    });

    it('does not send a percentage outside 1 to 99', async () => {
      const { fixture, page } = await render();
      const percent = page.querySelector<HTMLInputElement>('[data-add-percent]')!;

      percent.value = '100';
      percent.dispatchEvent(new Event('input'));
      page.querySelector<HTMLButtonElement>('[data-add-ratio]')!.click();
      await fixture.whenStable();

      expect(text(page.querySelector('[role=alert]'))).toContain('1 och 99');
    });

    it('edits a past entry', async () => {
      const { fixture, page, http } = await render([
        { from: '2026-01-01', percent: 60 },
        { from: '2026-07-01', percent: 55 },
      ]);

      page.querySelector<HTMLButtonElement>('[data-ratio-entry] [data-edit]')!.click();
      await fixture.whenStable();
      const percent = page.querySelector<HTMLInputElement>('[data-edit-percent]')!;
      percent.value = '65';
      percent.dispatchEvent(new Event('input'));
      page.querySelector<HTMLButtonElement>('[data-save-edit]')!.click();

      expect(http.expectOne('/api/household-ratio').request.body).toEqual({
        entries: [
          { from: '2026-01-01', percent: 65 },
          { from: '2026-07-01', percent: 55 },
        ],
      });
    });

    it('removes an entry, but never the last one', async () => {
      const { fixture, page, http } = await render([
        { from: '2026-01-01', percent: 60 },
        { from: '2026-07-01', percent: 55 },
      ]);

      page.querySelectorAll<HTMLButtonElement>('[data-remove]')[1]!.click();
      const put = http.expectOne('/api/household-ratio');
      expect(put.request.body).toEqual({ entries: [{ from: '2026-01-01', percent: 60 }] });
      put.flush(put.request.body);
      await fixture.whenStable();

      expect(page.querySelector<HTMLButtonElement>('[data-remove]')!.disabled).toBe(true);
    });
  });

  it('shows an error when the lists cannot be fetched', async () => {
    const fixture = TestBed.createComponent(AndelarPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/subcategory-shares').flush({ shares: [] });
    http.expectOne('/api/household-ratio').flush({ entries: [] });
    http.expectOne('/api/categories').error(new ProgressEvent('error'));
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[role=alert]')).not.toBeNull();
  });
});
