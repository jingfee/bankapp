import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ManualSavingsAccount } from '@bankapp/shared';
import { ManualSavingsSection } from './manual-savings-section';

const ISK: ManualSavingsAccount = {
  id: 7,
  name: 'Avanza ISK',
  institution: 'Avanza',
  closedOn: null,
  entries: [
    { id: 2, date: '2025-11-27', balance: 409500, netDeposits: 305000 },
    { id: 1, date: '2025-10-28', balance: 400000, netDeposits: null },
  ],
  balance: 409500,
  netDeposits: 305000,
  growth: 104500,
  growthApproximate: true,
};

describe('ManualSavingsSection', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function render(accounts: ManualSavingsAccount[] = [ISK]) {
    const fixture = TestBed.createComponent(ManualSavingsSection);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/manual-savings-accounts').flush({ accounts });
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

  it('lists accounts with their entries newest first, leaving the figures to the Sparande page', async () => {
    const { root } = await render();
    expect(root.querySelector('[data-manual-name]')?.textContent).toContain('Avanza ISK');
    expect(root.querySelector('[data-growth]')).toBeNull();
    const days = Array.from(root.querySelectorAll('[data-entry-day]')).map((d) => d.textContent);
    expect(days).toEqual(['2025-11-27', '2025-10-28']);
  });

  it('sends a new entry with Swedish-format amounts and leaves blank net deposits null', async () => {
    const { http, root, click, type } = await render();
    await click('[data-new-entry]');
    expect(root.textContent).toContain('Som det står hos banken');
    await type('[data-entry-balance]', '410 000,50');
    await click('[data-save-entry]');
    const request = http.expectOne('/api/manual-savings-accounts/7/entries');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ balance: 410000.5, netDeposits: null });
    expect(request.request.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    request.flush({ ...ISK, balance: 410000.5 });
  });

  it('sends net deposits when given', async () => {
    const { http, click, type } = await render();
    await click('[data-new-entry]');
    await type('[data-entry-balance]', '1000');
    await type('[data-entry-deposits]', '900,5');
    await click('[data-save-entry]');
    const request = http.expectOne('/api/manual-savings-accounts/7/entries');
    expect(request.request.body).toMatchObject({ balance: 1000, netDeposits: 900.5 });
    request.flush(ISK);
  });

  it('refuses a missing or non-numeric balance without calling the server', async () => {
    const { root, click, type } = await render();
    await click('[data-new-entry]');
    await click('[data-save-entry]');
    expect(root.querySelector('[data-entry-error]')).not.toBeNull();
    await type('[data-entry-balance]', 'abc');
    await click('[data-save-entry]');
    expect(root.querySelector('[data-entry-error]')).not.toBeNull();
    await type('[data-entry-balance]', '100');
    await type('[data-entry-deposits]', 'x');
    await click('[data-save-entry]');
    expect(root.querySelector('[data-entry-error]')?.textContent).toContain('insatt');
  });

  it('corrects an entry in place, prefilled', async () => {
    const { http, root, click, type } = await render();
    await click('[data-edit-entry]');
    expect(root.querySelector<HTMLInputElement>('[data-entry-balance]')!.value).toBe('409500');
    expect(root.querySelector<HTMLInputElement>('[data-entry-deposits]')!.value).toBe('305000');
    await type('[data-entry-balance]', '409600');
    await click('[data-save-entry]');
    const request = http.expectOne('/api/manual-savings-accounts/7/entries/2');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toMatchObject({ date: '2025-11-27', balance: 409600 });
    request.flush(ISK);
  });

  it('says so when a day already has an entry', async () => {
    const { fixture, http, root, click, type } = await render();
    await click('[data-edit-entry]');
    await type('[data-entry-balance]', '1');
    await click('[data-save-entry]');
    http
      .expectOne('/api/manual-savings-accounts/7/entries/2')
      .flush({}, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    expect(root.querySelector('[data-entry-error]')?.textContent).toContain('redan');
  });

  it('adds an account with a name and optional institution', async () => {
    const { http, click, type } = await render([]);
    await click('[data-open-add-account]');
    await type('[data-account-name-input]', 'Avanza ISK');
    await click('[data-save-account]');
    const request = http.expectOne('/api/manual-savings-accounts');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Avanza ISK', institution: null });
    request.flush({ ...ISK, entries: [], balance: null, growth: null, netDeposits: null });
  });

  it('closes an account on a date and reopens a closed one', async () => {
    const { fixture, http, root, click } = await render();
    await click('[data-close]');
    await click('[data-confirm-close]');
    const close = http.expectOne('/api/manual-savings-accounts/7/close');
    expect(close.request.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    close.flush({ ...ISK, closedOn: '2026-12-15', balance: 0, growth: null });
    await fixture.whenStable();
    expect(root.querySelector('[data-closed]')).not.toBeNull();
    expect(root.querySelector('[data-new-entry]')).toBeNull();
    await click('[data-reopen]');
    http.expectOne('/api/manual-savings-accounts/7/reopen').flush(ISK);
  });
});
