import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { TransactionDetails } from '@bankapp/shared';
import { TransactionDetailsPage } from './transaction-details.page';

describe('TransactionDetailsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TransactionDetailsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '**', children: [] }]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: '5' }) } },
        },
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const details = (overrides: Partial<TransactionDetails> = {}): TransactionDetails => ({
    id: 5,
    status: 'booked',
    amount: { amount: -12.5, currency: 'SEK' },
    description: 'Lunch Rom',
    account: { id: 7, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
    transactionDate: null,
    bookingDate: null,
    counterparty: null,
    originalAmount: null,
    exchangeRate: null,
    remittanceInformation: [],
    referenceNumber: null,
    note: null,
    raw: '{"a":1}',
    ...overrides,
  });

  async function render(response: TransactionDetails | { httpStatus: number }) {
    const fixture = TestBed.createComponent(TransactionDetailsPage);
    await fixture.whenStable();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/transactions/5');
    if ('httpStatus' in response) {
      request.flush('', { status: response.httpStatus, statusText: 'x' });
    } else request.flush(response);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    const field = (key: string) =>
      page.querySelector(`[data-field="${key}"]`)?.textContent?.trim() ?? null;
    return { fixture, page, field };
  }

  it('shows the details in Swedish', async () => {
    const { page, field } = await render(
      details({
        status: 'pending',
        transactionDate: '2026-11-08',
        bookingDate: '2026-11-10',
        counterparty: 'Café Roma',
        originalAmount: { amount: -1.12, currency: 'EUR' },
        exchangeRate: 11.2,
        remittanceInformation: ['Lunch', 'Rome'],
        referenceNumber: '12345',
        note: 'Team trip',
      }),
    );

    expect(page.querySelector('[data-description]')?.textContent?.trim()).toBe('Lunch Rom');
    expect(page.querySelector('[data-amount]')?.textContent?.trim()).toMatch(/^−12,50\skr$/);
    expect(field('status')).toBe('Reserverad');
    expect(field('bank')).toBe('Swedbank');
    expect(field('account')).toBe('Lönekonto (Betalkonto)');
    expect(field('transactionDate')).toBe('Söndag 8 november 2026');
    expect(field('bookingDate')).toBe('Tisdag 10 november 2026');
    expect(field('counterparty')).toBe('Café Roma');
    expect(field('originalAmount')).toMatch(/^−1,12\s€$/);
    expect(field('exchangeRate')).toBe('11,2');
    expect(field('remittanceInformation')).toBe('Lunch Rome');
    expect(field('referenceNumber')).toBe('12345');
    expect(field('note')).toBe('Team trip');
  });

  it('shows Bokförd for booked transactions and hides what the bank did not send', async () => {
    const { page, field } = await render(details());

    expect(field('status')).toBe('Bokförd');
    const shown = Array.from(page.querySelectorAll('[data-field]')).map((d) =>
      d.getAttribute('data-field'),
    );
    expect(shown).toEqual(['status', 'bank', 'account']);
  });

  it('has a collapsed Rådata section with pretty-printed JSON', async () => {
    const { page } = await render(details({ raw: '{"a":{"b":1}}' }));

    const raw = page.querySelector('details[data-raw]') as HTMLDetailsElement;
    expect(raw.open).toBe(false);
    expect(raw.querySelector('summary')?.textContent?.trim()).toBe('Rådata');
    expect(raw.querySelector('[data-raw-json]')?.textContent).toBe(
      JSON.stringify({ a: { b: 1 } }, null, 2),
    );
  });

  it('says the transaction is gone, with a link to the list, when the id is unknown', async () => {
    const { page } = await render({ httpStatus: 404 });

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Transaktionen finns inte längre');
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an error for other failures', async () => {
    const { page } = await render({ httpStatus: 500 });

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('kunde inte hämtas');
  });

  it('goes back in history when the owner came from the list', async () => {
    const { fixture, page } = await render(details());
    const back = vi.spyOn(TestBed.inject(Location), 'back').mockImplementation(() => {});
    const router = TestBed.inject((await import('@angular/router')).Router);
    await router.navigateByUrl('/a');
    await router.navigateByUrl('/b');

    (page.querySelector('[data-back]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(back).toHaveBeenCalled();
  });
});
