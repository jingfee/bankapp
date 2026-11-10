import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AccountsResponse, HealthResponse } from '@bankapp/shared';
import { HomePage } from './home.page';

describe('HomePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  type Respond = (request: ReturnType<HttpTestingController['expectOne']>) => void;

  /** Renders the page and answers its health check and accounts request. */
  async function render(
    respondToHealth: Respond,
    respondToAccounts: Respond = noAccounts,
  ): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    respondToHealth(http.expectOne('/api/health'));
    respondToAccounts(http.expectOne('/api/accounts'));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const serverUp: Respond = (request) => request.flush({ status: 'ok' } satisfies HealthResponse);
  const serverDown: Respond = (request) => request.error(new ProgressEvent('error'));
  const noAccounts: Respond = (request) => request.flush({ banks: [] } satisfies AccountsResponse);

  it('greets the owner in Swedish with an empty state and a way to connect a bank', async () => {
    const page = await render(serverUp);

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Bankapp');
    expect(page.textContent).toContain('Inga banker är anslutna ännu.');
    const link = page.querySelector('a[href="/anslut-bank"]');
    expect(link?.textContent?.trim()).toBe('Anslut bank');
  });

  it('lists the accounts grouped by bank with their type', async () => {
    const page = await render(serverUp, (request) =>
      request.flush({
        banks: [
          { bank: 'Coop Mastercard', accounts: [{ name: 'Coop Mastercard', type: 'card' }] },
          {
            bank: 'Swedbank',
            accounts: [
              { name: 'Lönekonto', type: 'payment' },
              { name: 'Sparkonto', type: 'savings' },
            ],
          },
        ],
      } satisfies AccountsResponse),
    );

    expect(page.textContent).not.toContain('Inga banker är anslutna ännu.');
    const groups = Array.from(page.querySelectorAll('section[data-bank]')).map((group) => ({
      bank: group.querySelector('h2')?.textContent?.trim(),
      accounts: Array.from(group.querySelectorAll('li')).map((li) =>
        Array.from(li.querySelectorAll('span')).map((span) => span.textContent?.trim()),
      ),
    }));
    expect(groups).toEqual([
      { bank: 'Coop Mastercard', accounts: [['Coop Mastercard', 'Kortkonto']] },
      {
        bank: 'Swedbank',
        accounts: [
          ['Lönekonto', 'Betalkonto'],
          ['Sparkonto', 'Sparkonto'],
        ],
      },
    ]);
    expect(page.querySelector('a[href="/anslut-bank"]')?.textContent?.trim()).toBe('Anslut bank');
  });

  it('shows an error when the accounts cannot be fetched', async () => {
    const page = await render(serverUp, serverDown);

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
    expect(page.textContent).not.toContain('Inga banker är anslutna ännu.');
  });

  it('shows that the server is reachable', async () => {
    const page = await render(serverUp);

    expect(page.textContent).toContain('Servern svarar');
    expect(page.textContent).not.toContain('Servern svarar inte');
  });

  it('shows that the server is unreachable', async () => {
    const page = await render(serverDown);

    expect(page.textContent).toContain('Servern svarar inte');
  });
});
