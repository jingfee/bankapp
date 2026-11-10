import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  AccountsResponse,
  BankAccounts,
  ConnectedAccount,
  HealthResponse,
  SyncSummary,
} from '@bankapp/shared';
import { Redirector } from '../../redirector';
import { HomePage, SYNC_POLL_INTERVAL_MS } from './home.page';

describe('HomePage', () => {
  let redirects: string[];

  beforeEach(() => {
    redirects = [];
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Redirector, useValue: { goTo: (url: string) => redirects.push(url) } },
      ],
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

  const account = (name: string, type: ConnectedAccount['type'], id = 1): ConnectedAccount => ({
    id,
    name,
    type,
    balance: null,
    lastSyncedAt: null,
  });

  /** A bank group whose connection is good for a long time. */
  const group = (
    bank: string,
    accounts: ConnectedAccount[],
    overrides: Partial<BankAccounts> = {},
  ): BankAccounts => ({
    bank,
    status: 'active',
    validUntil: '2099-01-01T00:00:00.000Z',
    accounts,
    closedAccounts: [],
    ...overrides,
  });

  const serverUp: Respond = (request) => request.flush({ status: 'ok' } satisfies HealthResponse);
  const serverDown: Respond = (request) => request.error(new ProgressEvent('error'));
  const noAccounts: Respond = (request) =>
    request.flush({ banks: [], syncing: false, lastSync: null } satisfies AccountsResponse);

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
          group('Coop Mastercard', [account('Coop Mastercard', 'card')]),
          group('Swedbank', [account('Lönekonto', 'payment'), account('Sparkonto', 'savings')]),
        ],
        syncing: false,
        lastSync: null,
      } satisfies AccountsResponse),
    );

    expect(page.textContent).not.toContain('Inga banker är anslutna ännu.');
    const groups = Array.from(page.querySelectorAll('section[data-bank]')).map((group) => ({
      bank: group.querySelector('h2')?.textContent?.trim(),
      accounts: Array.from(group.querySelectorAll('li')).map((li) =>
        Array.from(li.querySelectorAll(':scope > span:first-child > *')).map((span) =>
          span.textContent?.trim(),
        ),
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

  it('links each account to its transactions', async () => {
    const page = await render(serverUp, (request) =>
      request.flush({
        banks: [group('Swedbank', [account('Lönekonto', 'payment', 42)])],
        syncing: false,
        lastSync: null,
      } satisfies AccountsResponse),
    );

    expect(page.querySelector('a[href="/konto/42"]')?.textContent?.trim()).toBe('Lönekonto');
  });

  describe('balances and syncing', () => {
    const swedbank = (
      accounts: ConnectedAccount[],
      syncing: boolean,
      lastSync: SyncSummary | null = null,
    ): AccountsResponse => ({
      banks: [group('Swedbank', accounts)],
      syncing,
      lastSync,
    });

    it('shows each balance in Swedish format and when the account was last synced', async () => {
      const page = await render(serverUp, (request) =>
        request.flush(
          swedbank(
            [
              {
                ...account('Kort', 'card'),
                balance: { amount: -1234.5, currency: 'SEK' },
                lastSyncedAt: '2026-11-10T12:00:00.000Z',
              },
              account('Lönekonto', 'payment'),
            ],
            false,
          ),
        ),
      );

      const [first, second] = Array.from(page.querySelectorAll('li'));
      expect(first?.querySelector('[data-balance]')?.textContent?.trim()).toBe(
        '−1\u00a0234,50\u00a0kr',
      );
      expect(first?.querySelector('[data-synced]')?.textContent?.trim()).toBe(
        'Uppdaterad 10 nov. 13:00',
      );
      expect(second?.querySelector('[data-balance]')?.textContent?.trim()).toBe('–');
      expect(second?.querySelector('[data-synced]')?.textContent?.trim()).toBe(
        'Inte uppdaterad ännu',
      );
      expect(page.querySelector('[role=status]')).toBeNull();
    });

    it('keeps the accounts and keeps polling when a refresh fails during a sync', async () => {
      vi.useFakeTimers();
      try {
        const fixture = TestBed.createComponent(HomePage);
        const http = TestBed.inject(HttpTestingController);
        await vi.advanceTimersByTimeAsync(0);
        http.expectOne('/api/health').flush({ status: 'ok' } satisfies HealthResponse);
        http.expectOne('/api/accounts').flush(swedbank([account('Lönekonto', 'payment')], true));
        await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
        http.expectOne('/api/accounts').error(new ProgressEvent('error'));
        await vi.advanceTimersByTimeAsync(0);
        const page = fixture.nativeElement as HTMLElement;
        expect(page.querySelector('[role=alert]')).toBeNull();
        expect(page.textContent).toContain('Lönekonto');

        await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
        http.expectOne('/api/accounts').flush(swedbank([account('Lönekonto', 'payment')], false));
        await vi.advanceTimersByTimeAsync(0);
        expect(page.querySelector('[role=status]')).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows that a sync is running and updates when it has finished', async () => {
      vi.useFakeTimers();
      try {
        const fixture = TestBed.createComponent(HomePage);
        const http = TestBed.inject(HttpTestingController);
        await vi.advanceTimersByTimeAsync(0);
        http.expectOne('/api/health').flush({ status: 'ok' } satisfies HealthResponse);
        http.expectOne('/api/accounts').flush(swedbank([account('Lönekonto', 'payment')], true));
        await vi.advanceTimersByTimeAsync(0);
        const page = fixture.nativeElement as HTMLElement;
        expect(page.querySelector('[role=status]')?.textContent).toContain('pågår');

        await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
        http.expectOne('/api/accounts').flush(
          swedbank(
            [
              {
                ...account('Lönekonto', 'payment'),
                balance: { amount: 89, currency: 'SEK' },
                lastSyncedAt: '2026-11-10T12:00:00.000Z',
              },
            ],
            false,
          ),
        );
        await vi.advanceTimersByTimeAsync(0);

        expect(page.querySelector('[role=status]')).toBeNull();
        expect(page.querySelector('[data-balance]')?.textContent?.trim()).toBe('89,00\u00a0kr');

        // Done: it stops asking.
        await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 3);
        http.expectNone('/api/accounts');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('the Uppdatera button', () => {
    const summary = (overrides: Partial<SyncSummary> = {}): SyncSummary => ({
      finishedAt: '2026-11-10T12:00:00.000Z',
      newTransactions: 0,
      failedAccounts: 0,
      rateLimited: false,
      ...overrides,
    });
    const swedbank = (
      syncing: boolean,
      lastSync: SyncSummary | null = null,
      lastSyncedAt: string | null = null,
    ): AccountsResponse => ({
      banks: [group('Swedbank', [{ ...account('Lönekonto', 'payment'), lastSyncedAt }])],
      syncing,
      lastSync,
    });

    /** Renders the page showing an idle overview, with fake timers so polling can be stepped. */
    async function renderIdle(accounts: AccountsResponse = swedbank(false)) {
      vi.useFakeTimers();
      const fixture = TestBed.createComponent(HomePage);
      const http = TestBed.inject(HttpTestingController);
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne('/api/health').flush({ status: 'ok' } satisfies HealthResponse);
      http.expectOne('/api/accounts').flush(accounts);
      await vi.advanceTimersByTimeAsync(0);
      const page = fixture.nativeElement as HTMLElement;
      const button = () => page.querySelector<HTMLButtonElement>('button[data-sync]');
      return { page, http, button };
    }

    afterEach(() => vi.useRealTimers());

    it('starts a sync, shows progress and then how many transactions were new', async () => {
      const { page, http, button } = await renderIdle();
      expect(button()?.textContent?.trim()).toBe('Uppdatera');

      button()!.click();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne('/api/accounts').flush(swedbank(true));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[role=status]')?.textContent).toContain('Uppdaterar');
      expect(button()?.disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
      http
        .expectOne('/api/accounts')
        .flush(swedbank(false, summary({ newTransactions: 3 }), '2026-11-10T12:00:00.000Z'));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[role=status]')?.textContent).toContain('3 nya transaktioner');
      expect(button()?.disabled).toBe(false);
    });

    it('says so when nothing was new, and uses the singular for one', async () => {
      const { page, http, button } = await renderIdle();

      for (const [count, text] of [
        [0, 'Inga nya transaktioner'],
        [1, '1 ny transaktion'],
      ] as const) {
        button()!.click();
        await vi.advanceTimersByTimeAsync(0);
        http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
        await vi.advanceTimersByTimeAsync(0);
        http.expectOne('/api/accounts').flush(swedbank(false, summary({ newTransactions: count })));
        await vi.advanceTimersByTimeAsync(0);
        expect(page.querySelector('[role=status]')?.textContent).toContain(text);
      }
    });

    it('mentions accounts the bank could not deliver', async () => {
      const { page, http, button } = await renderIdle();

      button()!.click();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
      await vi.advanceTimersByTimeAsync(0);
      http
        .expectOne('/api/accounts')
        .flush(swedbank(false, summary({ newTransactions: 2, failedAccounts: 1 })));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[role=alert]')?.textContent).toContain('1 konto kunde inte');
      expect(page.querySelector('[role=status]')?.textContent).toContain('2 nya transaktioner');
    });

    it('explains a rate limit and shows when the data is from', async () => {
      const { page, http, button } = await renderIdle(
        swedbank(false, null, '2026-11-10T08:30:00.000Z'),
      );

      button()!.click();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
      await vi.advanceTimersByTimeAsync(0);
      http
        .expectOne('/api/accounts')
        .flush(swedbank(false, summary({ rateLimited: true }), '2026-11-10T08:30:00.000Z'));
      await vi.advanceTimersByTimeAsync(0);

      const alert = page.querySelector('[role=alert]')?.textContent;
      expect(alert).toContain('Banken tillåter inte fler uppdateringar just nu');
      expect(alert).toContain('Senast uppdaterad 10 nov. 09:30');
      expect(page.querySelector('[data-balance]')).not.toBeNull();
    });

    it('keeps following the sync when a poll fails', async () => {
      const { page, http, button } = await renderIdle();

      button()!.click();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne('/api/accounts').error(new ProgressEvent('error'));
      await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
      http.expectOne('/api/accounts').flush(swedbank(false, summary({ newTransactions: 2 })));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[role=status]')?.textContent).toContain('2 nya transaktioner');
      expect(button()?.disabled).toBe(false);
    });

    it('shows an error when the sync cannot be started', async () => {
      const { page, http, button } = await renderIdle();

      button()!.click();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne({ method: 'POST', url: '/api/sync' }).error(new ProgressEvent('error'));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[role=alert]')?.textContent).toContain(
        'Uppdateringen kunde inte startas',
      );
      expect(button()?.disabled).toBe(false);
    });

    it('is not offered when no bank is connected', async () => {
      const { button } = await renderIdle({ banks: [], syncing: false, lastSync: null });

      expect(button()).toBeNull();
    });
  });

  describe('connection expiry and renewal', () => {
    const DAY = 24 * 3600 * 1000;
    const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();
    const swedbank = (overrides: Partial<BankAccounts>) => (request: TestRequest) =>
      request.flush({
        banks: [group('Swedbank', [account('Lönekonto', 'payment')], overrides)],
        syncing: false,
        lastSync: null,
      } satisfies AccountsResponse);
    const renewButton = (page: HTMLElement) =>
      Array.from(page.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Anslut igen',
      );

    it('shows nothing about a connection that is good for a while', async () => {
      const page = await render(serverUp, swedbank({ status: 'active' }));

      expect(page.textContent).not.toContain('går ut');
      expect(page.textContent).not.toContain('gått ut');
      expect(renewButton(page)).toBeUndefined();
    });

    it('warns in Swedish when a connection is about to expire and offers to renew it', async () => {
      const page = await render(serverUp, swedbank({ status: 'expiring', validUntil: inDays(10) }));

      const banner = page.querySelector('[data-expiry]');
      expect(banner?.textContent).toContain('Kopplingen till Swedbank går ut om 10 dagar.');
      expect(renewButton(page)).toBeDefined();
    });

    it('says "1 dag" when a day is left', async () => {
      const page = await render(
        serverUp,
        swedbank({ status: 'expiring', validUntil: inDays(0.5) }),
      );

      expect(page.querySelector('[data-expiry]')?.textContent).toContain('går ut om 1 dag.');
    });

    it('tells the owner a connection has expired and marks its accounts as not syncing', async () => {
      const page = await render(serverUp, swedbank({ status: 'expired', validUntil: inDays(-2) }));

      expect(page.querySelector('[data-expiry]')?.textContent).toContain(
        'Kopplingen till Swedbank har gått ut. Kontona uppdateras inte längre.',
      );
      expect(page.querySelector('li [data-not-syncing]')?.textContent?.trim()).toBe(
        'Uppdateras inte',
      );
      expect(page.querySelector('a[href="/konto/1"]')).not.toBeNull();
      expect(renewButton(page)).toBeDefined();
    });

    it('sends the owner to BankID to renew the same bank', async () => {
      const page = await render(serverUp, swedbank({ status: 'expired' }));
      const http = TestBed.inject(HttpTestingController);

      renewButton(page)!.click();
      const request = http.expectOne({ method: 'POST', url: '/api/connections' });
      expect(request.request.body).toEqual({ bank: 'Swedbank' });
      request.flush({ url: 'https://bankid.example/auth' });

      expect(redirects).toEqual(['https://bankid.example/auth']);
    });

    it('says so when the renewal cannot be started', async () => {
      const page = await render(serverUp, swedbank({ status: 'expired' }));
      const http = TestBed.inject(HttpTestingController);

      renewButton(page)!.click();
      http.expectOne({ method: 'POST', url: '/api/connections' }).error(new ProgressEvent('error'));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain(
        'Förnyelsen kunde inte startas',
      );
      expect(redirects).toEqual([]);
    });

    it('shows closed accounts apart from the others, still linked to their history', async () => {
      const page = await render(
        serverUp,
        swedbank({ closedAccounts: [account('Sparkonto', 'savings', 9)] }),
      );

      const closed = page.querySelector('[data-closed-accounts]');
      expect(closed?.querySelector('h3')?.textContent?.trim()).toBe('Avslutade konton');
      expect(closed?.querySelector('a[href="/konto/9"]')?.textContent?.trim()).toBe('Sparkonto');
      expect(page.querySelector('section[data-bank] > ul a[href="/konto/9"]')).toBeNull();
    });
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
