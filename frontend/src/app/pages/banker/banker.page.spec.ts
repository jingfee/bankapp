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
  SyncSummary,
} from '@bankapp/shared';
import { Redirector } from '../../redirector';
import { BankerPage, SYNC_POLL_INTERVAL_MS } from './banker.page';

describe('BankerPage', () => {
  let redirects: string[];

  beforeEach(() => {
    redirects = [];
    TestBed.configureTestingModule({
      imports: [BankerPage],
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

  /** Renders the page and answers its accounts request. */
  async function render(respondToAccounts: Respond = noAccounts): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(BankerPage);
    await fixture.whenStable();
    const http = TestBed.inject(HttpTestingController);
    respondToAccounts(http.expectOne('/api/accounts'));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const account = (name: string, type: ConnectedAccount['type'], id = 1): ConnectedAccount => ({
    id,
    name,
    type,
    balance: null,
    hidden: false,
    share: 'me',
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

  const failed: Respond = (request) => request.error(new ProgressEvent('error'));
  const noAccounts: Respond = (request) =>
    request.flush({ banks: [], syncing: false, lastSync: null } satisfies AccountsResponse);

  it('has an empty state with a way to connect a bank', async () => {
    const page = await render();

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Banker');
    expect(page.textContent).toContain('Inga banker är anslutna ännu.');
    const link = page.querySelector('a[href="/anslut-bank"]');
    expect(link?.textContent?.trim()).toBe('Anslut bank');
  });

  it('lists the accounts grouped by bank with their type', async () => {
    const page = await render((request) =>
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
        Array.from(li.querySelectorAll(':scope > span:first-child > span')).map((span) =>
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

  it('does not show the Servern svarar indicator or a transactions link', async () => {
    const page = await render((request) =>
      request.flush({
        banks: [group('Swedbank', [account('Lönekonto', 'payment', 42)])],
        syncing: false,
        lastSync: null,
      } satisfies AccountsResponse),
    );

    expect(page.textContent).not.toContain('Servern svarar');
    expect(page.querySelector('a[href="/transaktioner"]')).toBeNull();
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
      const page = await render((request) =>
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
        const fixture = TestBed.createComponent(BankerPage);
        const http = TestBed.inject(HttpTestingController);
        await vi.advanceTimersByTimeAsync(0);
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
        const fixture = TestBed.createComponent(BankerPage);
        const http = TestBed.inject(HttpTestingController);
        await vi.advanceTimersByTimeAsync(0);
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
      const fixture = TestBed.createComponent(BankerPage);
      const http = TestBed.inject(HttpTestingController);
      await vi.advanceTimersByTimeAsync(0);
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
        (button) => button.textContent?.trim() === 'Förnya',
      );

    it('shows the days left on a connection that is good for a while, without a warning', async () => {
      const page = await render(swedbank({ status: 'active', validUntil: inDays(60) }));

      expect(page.querySelector('[data-days-left]')?.textContent?.trim()).toBe(
        'Kopplingen går ut om 60 dagar.',
      );
      expect(page.querySelector('[data-expiry]')).toBeNull();
    });

    it('lets the owner renew a connection that is still active', async () => {
      const page = await render(swedbank({ status: 'active', validUntil: inDays(60) }));
      const http = TestBed.inject(HttpTestingController);

      renewButton(page)!.click();
      const request = http.expectOne({ method: 'POST', url: '/api/connections' });
      expect(request.request.body).toEqual({ bank: 'Swedbank', renew: true });
      request.flush({ url: 'https://bankid.example/auth' });

      expect(redirects).toEqual(['https://bankid.example/auth']);
    });

    it('warns in Swedish when a connection is about to expire and offers to renew it', async () => {
      const page = await render(swedbank({ status: 'expiring', validUntil: inDays(10) }));

      const banner = page.querySelector('[data-expiry]');
      expect(banner?.textContent).toContain('Kopplingen till Swedbank går ut om 10 dagar.');
      expect(renewButton(page)).toBeDefined();
    });

    it('says "1 dag" when a day is left', async () => {
      const page = await render(swedbank({ status: 'expiring', validUntil: inDays(0.5) }));

      expect(page.querySelector('[data-expiry]')?.textContent).toContain('går ut om 1 dag.');
    });

    it('tells the owner a connection has expired and marks its accounts as not syncing', async () => {
      const page = await render(swedbank({ status: 'expired', validUntil: inDays(-2) }));

      expect(page.querySelector('[data-expiry]')?.textContent).toContain(
        'Kopplingen till Swedbank har gått ut. Kontona uppdateras inte längre.',
      );
      expect(page.querySelector('li [data-not-syncing]')?.textContent?.trim()).toBe(
        'Uppdateras inte',
      );
      expect(renewButton(page)).toBeDefined();
    });

    it('sends the owner to BankID to renew the same bank', async () => {
      const page = await render(swedbank({ status: 'expired' }));
      const http = TestBed.inject(HttpTestingController);

      renewButton(page)!.click();
      const request = http.expectOne({ method: 'POST', url: '/api/connections' });
      expect(request.request.body).toEqual({ bank: 'Swedbank' });
      request.flush({ url: 'https://bankid.example/auth' });

      expect(redirects).toEqual(['https://bankid.example/auth']);
    });

    it('says so when the renewal cannot be started', async () => {
      const page = await render(swedbank({ status: 'expired' }));
      const http = TestBed.inject(HttpTestingController);

      renewButton(page)!.click();
      http.expectOne({ method: 'POST', url: '/api/connections' }).error(new ProgressEvent('error'));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain(
        'Förnyelsen kunde inte startas',
      );
      expect(redirects).toEqual([]);
    });

    it('shows closed accounts apart from the others', async () => {
      const page = await render(swedbank({ closedAccounts: [account('Sparkonto', 'savings', 9)] }));

      const closed = page.querySelector('[data-closed-accounts]');
      expect(closed?.querySelector('h3')?.textContent?.trim()).toBe('Avslutade konton');
      expect(closed?.textContent).toContain('Sparkonto');
      expect(page.querySelector('section[data-bank] > ul')?.textContent).not.toContain('Sparkonto');
    });
  });

  describe('hiding an account', () => {
    it('hides a shown account and fetches the accounts again', async () => {
      const response = (hidden: boolean): AccountsResponse => ({
        banks: [group('Swedbank', [{ ...account('Lönekonto', 'payment', 7), hidden }])],
        syncing: false,
        lastSync: null,
      });
      const page = await render((request) => request.flush(response(false)));
      const button = page.querySelector<HTMLButtonElement>('[data-toggle-hidden]');
      expect(button?.textContent?.trim()).toBe('Dölj konto');
      expect(page.querySelector('[data-hidden]')).toBeNull();

      button?.click();
      const http = TestBed.inject(HttpTestingController);
      const put = http.expectOne('/api/accounts/7/hidden');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ hidden: true });
      put.flush(null);
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne('/api/accounts').flush(response(true));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[data-hidden]')?.textContent?.trim()).toBe('Dold');
      expect(page.querySelector('[data-toggle-hidden]')?.textContent?.trim()).toBe('Visa konto');
    });
  });

  describe('the share of an account', () => {
    const response = (share: ConnectedAccount['share']): AccountsResponse => ({
      banks: [group('Swedbank', [{ ...account('Coop Mastercard', 'card', 7), share }])],
      syncing: false,
      lastSync: null,
    });
    const select = (page: HTMLElement) => page.querySelector<HTMLSelectElement>('[data-share]');

    it('shows the options with the account’s share selected', async () => {
      const page = await render((request) => request.flush(response('half')));

      const options = [...(select(page)?.options ?? [])];
      expect(options.map((o) => o.textContent?.trim())).toEqual([
        'Jag',
        '50/50',
        'Hushåll',
        'Partner',
      ]);
      expect(select(page)?.value).toBe('half');
    });

    it('saves a chosen share and fetches the accounts again', async () => {
      const page = await render((request) => request.flush(response('me')));
      const control = select(page)!;

      control.value = 'partner';
      control.dispatchEvent(new Event('change'));
      const http = TestBed.inject(HttpTestingController);
      const put = http.expectOne('/api/accounts/7/share');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ share: 'partner' });
      put.flush(null);
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne('/api/accounts').flush(response('partner'));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(select(page)?.value).toBe('partner');
    });

    it('says so when Hushåll cannot be chosen yet', async () => {
      const page = await render((request) => request.flush(response('me')));
      const control = select(page)!;

      control.value = 'household';
      control.dispatchEvent(new Event('change'));
      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne('/api/accounts/7/share')
        .flush({ message: 'no ratio' }, { status: 409, statusText: 'Conflict' });
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain('Hushåll');
      expect(select(page)?.value).toBe('me');
    });
  });

  it('shows an error when the accounts cannot be fetched', async () => {
    const page = await render(failed);

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
    expect(page.textContent).not.toContain('Inga banker är anslutna ännu.');
  });
});
