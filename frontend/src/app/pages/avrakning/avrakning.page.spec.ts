import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SettlementPeriod, SettlementResponse } from '@bankapp/shared';
import { AvrakningPage } from './avrakning.page';

describe('AvrakningPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AvrakningPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const period = (overrides: Partial<SettlementPeriod> = {}): SettlementPeriod => ({
    carriedIn: 0,
    closedOn: null,
    balanceSettings: [],
    items: [],
    paid: 0,
    carriedOut: 0,
    ...overrides,
  });

  const response = (overrides: Partial<SettlementResponse> = {}): SettlementResponse => ({
    balance: null,
    periods: [],
    balanceSettings: [],
    ...overrides,
  });

  async function render(body: SettlementResponse | 'error') {
    const fixture = TestBed.createComponent(AvrakningPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne('/api/settlement');
    if (body === 'error') request.error(new ProgressEvent('error'));
    else request.flush(body);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement, http };
  }

  const text = (el: Element | null | undefined) =>
    el?.textContent?.replace(/[ \t\n\r]+/g, ' ').trim();

  it('says when it cannot be fetched', async () => {
    const { page } = await render('error');

    expect(page.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('explains the switch from the spreadsheet before the first balance setting', async () => {
    const { page } = await render(response());

    expect(text(page.querySelector('[data-switch-help]'))).toContain(
      'partnerns andel av det som redan är betalt, per idag',
    );
    expect(text(page.querySelector('[data-switch-help]'))).toContain('negativt');
    expect(page.querySelector('[data-balance]')).toBeNull();
  });

  it('shows what the partner owes', async () => {
    const { page } = await render(response({ balance: 312 }));

    expect(text(page.querySelector('[data-balance]'))).toBe('312,00 kr att få');
  });

  it('shows att betala for a negative balance', async () => {
    const { page } = await render(response({ balance: -312 }));

    expect(text(page.querySelector('[data-balance]'))).toBe('312,00 kr att betala');
  });

  it('lists the periods newest first with carried in, partner’s part, paid and carried out', async () => {
    const { page } = await render(
      response({
        balance: 80,
        periods: [
          period({ carriedIn: 50, carriedOut: 80 }),
          period({
            closedOn: '2026-10-20',
            carriedIn: 0,
            balanceSettings: [{ amount: 100, asOf: '2026-10-01' }],
            items: [
              {
                transactionId: 3,
                date: '2026-10-05',
                description: 'ICA Maxi',
                accountName: 'Coop Mastercard',
                amount: -1000,
                share: 'half',
                partnerPart: 500,
              },
            ],
            paid: 550,
            carriedOut: 50,
          }),
        ],
      }),
    );

    const periods = [...page.querySelectorAll('[data-period]')];
    expect(periods.map((p) => text(p.querySelector('[data-period-title]')))).toEqual([
      'Pågående period',
      'Avräknad 2026-10-20',
    ]);
    const closed = periods[1]!;
    expect(text(closed.querySelector('[data-carried-in]'))).toBe('0,00 kr');
    expect(text(closed.querySelector('[data-period-setting]'))).toBe(
      'Saldo inställt per 2026-10-01: 100,00 kr',
    );
    expect(text(closed.querySelector('[data-item]'))).toContain('ICA Maxi');
    expect(text(closed.querySelector('[data-partner-part]'))).toBe('500,00 kr');
    expect(text(closed.querySelector('[data-paid]'))).toBe('550,00 kr');
    expect(text(closed.querySelector('[data-carried-out]'))).toBe('50,00 kr');
  });

  it('sets the balance as of the chosen day and shows the new state', async () => {
    const { fixture, page, http } = await render(response());

    const amount = page.querySelector<HTMLInputElement>('[data-amount]')!;
    amount.value = '4312';
    amount.dispatchEvent(new Event('input'));
    const asOf = page.querySelector<HTMLInputElement>('[data-as-of]')!;
    asOf.value = '2026-11-01';
    asOf.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    page.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await fixture.whenStable();

    const post = http.expectOne('/api/settlement/balance-settings');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ amount: 4312, asOf: '2026-11-01' });
    post.flush(response({ balance: 4312, periods: [period({ carriedOut: 4312 })] }));
    await fixture.whenStable();

    expect(text(page.querySelector('[data-balance]'))).toBe('4 312,00 kr att få');
  });

  it('says when the setting could not be saved', async () => {
    const { fixture, page, http } = await render(response());
    const amount = page.querySelector<HTMLInputElement>('[data-amount]')!;
    amount.value = '10';
    amount.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    page.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await fixture.whenStable();

    http.expectOne('/api/settlement/balance-settings').error(new ProgressEvent('error'));
    await fixture.whenStable();

    expect(text(page.querySelector('[role="alert"]'))).toContain('kunde inte sparas');
  });
});
