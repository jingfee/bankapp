import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SavingsAccount, SavingsMonth, SavingsResponse } from '@bankapp/shared';
import { routes } from '../../app.routes';
import { SparandePage } from './sparande.page';

const account = (
  key: string,
  name: string,
  over: Partial<SavingsAccount> = {},
): SavingsAccount => ({
  key,
  name,
  institution: null,
  kind: 'manual',
  manualId: 1,
  closedOn: null,
  balance: 1000,
  netDeposits: 800,
  growth: 200,
  growthPercent: 25,
  approximate: false,
  lastUpdated: '2026-12-01',
  ...over,
});

const month = (
  m: string,
  accounts: [string, number, number | null][],
  over: Partial<SavingsMonth> = {},
): SavingsMonth => ({
  month: m,
  accounts: accounts.map(([key, balance, netDeposits]) => ({
    key,
    balance,
    netDeposits,
    growth: null,
  })),
  balance: accounts.reduce((sum, [, balance]) => sum + balance, 0),
  netDeposits: accounts.every(([, , d]) => d === null)
    ? null
    : accounts.reduce((sum, [, , d]) => sum + (d ?? 0), 0),
  growth: 10,
  approximate: false,
  ...over,
});

const RESPONSE: SavingsResponse = {
  accounts: [
    account('connected-1', 'Sparkonto', {
      kind: 'connected',
      manualId: null,
      institution: 'Swedbank',
    }),
    account('manual-1', 'Avanza ISK', { institution: 'Avanza', balance: 3000, netDeposits: 2000 }),
    account('manual-2', 'Gammal ISK', {
      closedOn: '2026-11-05',
      balance: 0,
      netDeposits: null,
      growth: null,
      growthPercent: null,
    }),
  ],
  months: [
    month('2026-10', [
      ['connected-1', 900, 800],
      ['manual-1', 2800, 2000],
    ]),
    month('2026-11', [
      ['connected-1', 950, 800],
      ['manual-1', 2900, 2000],
    ]),
    month('2026-12', [
      ['connected-1', 1000, 800],
      ['manual-1', 3000, 2000],
    ]),
  ],
  totals: {
    balance: 4000,
    netDeposits: 2800,
    growth: 1200,
    growthPercent: 42.9,
    approximate: false,
  },
  reminders: [],
};

describe('SparandePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SparandePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  async function render(response: SavingsResponse = RESPONSE) {
    const fixture = TestBed.createComponent(SparandePage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/savings').flush(response);
    http.expectOne('/api/manual-savings-accounts').flush({ accounts: [] });
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const text = (selector: string) =>
      root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    const select = async (value: string) => {
      const element = root.querySelector<HTMLSelectElement>('[data-account-select]')!;
      element.value = value;
      element.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const click = async (selector: string) => {
      root.querySelector<HTMLElement>(selector)!.click();
      await fixture.whenStable();
    };
    return { fixture, root, text, select, click };
  }

  it('is reachable at /sparande', () => {
    expect(routes[1]!.children!.find((r) => r.path === 'sparande')?.component).toBe(SparandePage);
  });

  it('shows the totals', async () => {
    const { text } = await render();
    expect(text('[data-total-balance]')).toContain('4 000');
    expect(text('[data-total-deposits]')).toContain('2 800');
    expect(text('[data-total-growth]')).toContain('1 200');
    expect(text('[data-total-growth-percent]')).toContain('42,9 %');
  });

  it('marks approximate totals with ≈', async () => {
    const { text } = await render({
      ...RESPONSE,
      totals: { ...RESPONSE.totals, approximate: true },
    });
    expect(text('[data-total-deposits]')).toContain('≈');
    expect(text('[data-total-growth]')).toContain('≈');
  });

  it('stacks every account and draws the net deposits line', async () => {
    const { root } = await render();
    expect(
      [...root.querySelectorAll('[data-area]')].map((a) => a.getAttribute('data-area')),
    ).toEqual(['connected-1', 'manual-1']);
    expect(root.querySelector('[data-line="deposits"]')).not.toBeNull();
  });

  it('shows only the selected account', async () => {
    const { root, select } = await render();
    await select('manual-1');
    expect(
      [...root.querySelectorAll('[data-area]')].map((a) => a.getAttribute('data-area')),
    ).toEqual(['manual-1']);
    await select('all');
    expect(root.querySelectorAll('[data-area]')).toHaveLength(2);
  });

  it('shows a month with its accounts, net deposits and growth on hover', async () => {
    const { root, text, fixture } = await render();
    root.querySelector('[data-chart-month="2026-11"]')!.dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    const tooltip = text('[data-chart-tooltip]')!;
    expect(tooltip).toContain('november 2026');
    expect(tooltip).toContain('Sparkonto (Swedbank) 950');
    expect(tooltip).toContain('Avanza ISK (Avanza) 2 900');
    expect(tooltip).toContain('Totalt 3 850');
    expect(tooltip).toContain('Insatt 2 800');
    expect(tooltip).toContain('Utveckling i månaden 10');
  });

  it('shows one year by default and all months with Allt', async () => {
    const months = Array.from({ length: 15 }, (_, i) => {
      const number = i + 1;
      const label =
        number <= 12
          ? `2025-${String(number).padStart(2, '0')}`
          : `2026-${String(number - 12).padStart(2, '0')}`;
      return month(label, [['manual-1', 100 + i, null]]);
    });
    const { root, click } = await render({ ...RESPONSE, months });
    expect(root.querySelectorAll('[data-chart-month]')).toHaveLength(12);
    await click('[data-range="all"]');
    expect(root.querySelectorAll('[data-chart-month]')).toHaveLength(15);
    await click('[data-range="year"]');
    expect(root.querySelectorAll('[data-chart-month]')).toHaveLength(12);
  });

  it('lists each account, with closed ones collapsed under Avslutade', async () => {
    const { root, text, click } = await render();
    const open = [...root.querySelectorAll('[data-accounts] > ul [data-account-name]')].map(
      (n) => n.textContent,
    );
    expect(open).toEqual(['Sparkonto (Swedbank)', 'Avanza ISK (Avanza)']);
    const toggle = '[data-closed-accounts] [data-disclosure-toggle]';
    expect(root.querySelector(toggle)?.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[data-closed-accounts]')?.textContent).not.toContain('Gammal ISK');
    expect(text(toggle)).toContain('Avslutade');
    await click(toggle);
    expect(root.querySelector('[data-closed-accounts]')?.textContent).toContain('Gammal ISK');
    expect(text('[data-account-row][data-key="manual-1"] [data-account-updated]')).toContain(
      '2026-12-01',
    );
    expect(text('[data-account-row][data-key="manual-1"]')).toContain('Utveckling');
  });

  it('shows a reminder for a manual account not updated in the month that ended', async () => {
    const { root } = await render({
      ...RESPONSE,
      reminders: [{ key: 'manual-1', name: 'Avanza ISK', month: '2026-11' }],
    });
    expect(root.querySelector('[data-reminder]')?.textContent?.trim()).toBe(
      'Avanza ISK är inte uppdaterat i november',
    );
  });

  it('shows no chart without any balance', async () => {
    const { root } = await render({ ...RESPONSE, accounts: [], months: [] });
    expect(root.querySelector('[data-chart-section]')).toBeNull();
    expect(root.textContent).toContain('Inga sparkonton ännu');
  });
});
