import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Transaction, TransactionsResponse } from '@bankapp/shared';
import { TransactionsPage } from './transactions.page';

describe('TransactionsPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TransactionsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const transaction = (id: number, overrides: Partial<Transaction> = {}): Transaction => ({
    id,
    status: 'booked',
    amount: { amount: -10, currency: 'SEK' },
    date: '2026-11-10',
    description: `Köp ${id}`,
    account: { id: 7, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
    ...overrides,
  });

  const response = (
    transactions: Transaction[],
    nextCursor: string | null = null,
  ): TransactionsResponse => ({
    transactions,
    nextCursor,
  });

  async function render(body: TransactionsResponse | 'error') {
    const fixture = TestBed.createComponent(TransactionsPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    const request = http.expectOne((r) => r.url === '/api/transactions');
    expect(request.request.params.has('before')).toBe(false);
    if (body === 'error') request.error(new ProgressEvent('error'));
    else request.flush(body);
    await fixture.whenStable();
    return { fixture, page: fixture.nativeElement as HTMLElement, http };
  }

  const rows = (page: HTMLElement) =>
    Array.from(page.querySelectorAll('li[data-transaction]')).map((li) => ({
      text: li.querySelector('[data-description]')?.textContent?.trim(),
      amount: li.querySelector('[data-amount]')?.textContent?.trim(),
    }));

  it('shows transactions grouped under Swedish date headings', async () => {
    const { page } = await render(
      response([
        transaction(3, { date: '2026-11-10' }),
        transaction(2, { date: '2026-11-09' }),
        transaction(1, { date: '2026-11-09' }),
      ]),
    );

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Transaktioner');
    const groups = Array.from(page.querySelectorAll('section[data-date]')).map((group) => ({
      heading: group.querySelector('h2')?.textContent?.trim(),
      descriptions: Array.from(group.querySelectorAll('[data-description]')).map((d) =>
        d.textContent?.trim(),
      ),
    }));
    expect(groups).toEqual([
      { heading: 'Tisdag 10 november 2026', descriptions: ['Köp 3'] },
      { heading: 'Måndag 9 november 2026', descriptions: ['Köp 2', 'Köp 1'] },
    ]);
  });

  it('shows amounts in Swedish format, with incoming money in green', async () => {
    const { page } = await render(
      response([
        transaction(2, { amount: { amount: 1500, currency: 'SEK' } }),
        transaction(1, { amount: { amount: -1234.5, currency: 'SEK' } }),
      ]),
    );

    const [incoming, outgoing] = Array.from(page.querySelectorAll('[data-amount]'));
    expect(incoming?.textContent?.trim()).toBe('1 500,00 kr');
    expect(incoming?.classList.contains('text-emerald-600')).toBe(true);
    expect(outgoing?.textContent?.trim()).toBe('−1 234,50 kr');
    expect(outgoing?.classList.contains('text-emerald-600')).toBe(false);
  });

  it('marks pending transactions as Reserverad and no others', async () => {
    const { page } = await render(
      response([transaction(2, { status: 'pending' }), transaction(1)]),
    );

    const [pending, booked] = Array.from(page.querySelectorAll('li[data-transaction]'));
    expect(pending?.textContent).toContain('Reserverad');
    expect(booked?.textContent).not.toContain('Reserverad');
  });

  it('names the account and bank of each transaction', async () => {
    const { page } = await render(
      response([
        transaction(2, {
          account: { id: 8, name: 'Sparkonto', bank: 'Skandia', type: 'savings' },
        }),
        transaction(1),
      ]),
    );

    expect(
      Array.from(page.querySelectorAll('[data-account]')).map((a) => a.textContent?.trim()),
    ).toEqual(['Sparkonto · Skandia', 'Lönekonto · Swedbank']);
  });

  it('says so when there are no transactions yet', async () => {
    const { page } = await render(response([]));

    expect(page.textContent).toContain('Inga transaktioner');
  });

  it('shows an error when the transactions cannot be fetched', async () => {
    const { page } = await render('error');

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
  });

  it('links back to the overview', async () => {
    const { page } = await render(response([]));

    expect(page.querySelector('a[href="/"]')).not.toBeNull();
  });

  describe('a long history', () => {
    it('loads the next page on request, continuing a day already shown, until there are no more', async () => {
      const { fixture, page, http } = await render(
        response([transaction(3, { date: '2026-11-10' }), transaction(2)], '2026-11-10:2'),
      );
      expect(rows(page)).toHaveLength(2);

      (page.querySelector('button[data-more]') as HTMLButtonElement).click();
      const next = http.expectOne(
        (r) => r.url === '/api/transactions' && r.params.get('before') === '2026-11-10:2',
      );
      next.flush(response([transaction(1, { date: '2026-11-10' })]));
      await fixture.whenStable();

      expect(rows(page).map((row) => row.text)).toEqual(['Köp 3', 'Köp 2', 'Köp 1']);
      expect(page.querySelectorAll('section[data-date]')).toHaveLength(1);
      expect(page.querySelector('button[data-more]')).toBeNull();
    });

    it('keeps what is shown and offers a retry when the next page fails', async () => {
      const { fixture, page, http } = await render(response([transaction(1)], '2026-11-10:1'));

      (page.querySelector('button[data-more]') as HTMLButtonElement).click();
      http
        .expectOne((r) => r.params.get('before') === '2026-11-10:1')
        .error(new ProgressEvent('error'));
      await fixture.whenStable();

      expect(rows(page)).toHaveLength(1);
      expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
      expect(page.querySelector('button[data-more]')).not.toBeNull();
    });
  });
});
