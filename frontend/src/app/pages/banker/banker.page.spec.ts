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
  SyncTrigger,
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
    savings: false,
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
    request.flush({
      banks: [],
      removedBanks: [],
      syncing: null,
      lastSync: null,
    } satisfies AccountsResponse);

  it('has an empty state with a way to connect a bank', async () => {
    const page = await render();

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Banker');
    expect(page.textContent).toContain('Inga banker anslutna');
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
        removedBanks: [],
        syncing: null,
        lastSync: null,
      } satisfies AccountsResponse),
    );

    expect(page.textContent).not.toContain('Inga banker anslutna');
    const groups = Array.from(page.querySelectorAll('section[data-bank]')).map((group) => ({
      bank: group.querySelector('h2')?.textContent?.trim(),
      accounts: Array.from(group.querySelectorAll('section > ul > li')).map((li) =>
        li.querySelector('[data-account-name]')?.textContent?.trim(),
      ),
      types: Array.from(group.querySelectorAll('section > ul > li')).map(
        (li) => li.textContent?.match(/(Betalkonto|Sparkonto|Kortkonto)/)?.[1],
      ),
      count: group.querySelector('[data-account-count]')?.textContent?.trim(),
    }));
    expect(groups).toEqual([
      {
        bank: 'Coop Mastercard',
        accounts: ['Coop Mastercard'],
        types: ['Kortkonto'],
        count: '1 konto',
      },
      {
        bank: 'Swedbank',
        accounts: ['Lönekonto', 'Sparkonto'],
        types: ['Betalkonto', 'Sparkonto'],
        count: '2 konton',
      },
    ]);
    expect(page.querySelector('a[href="/anslut-bank"]')?.textContent?.trim()).toBe('Anslut bank');
  });

  it('does not show the Servern svarar indicator or a transactions link', async () => {
    const page = await render((request) =>
      request.flush({
        banks: [group('Swedbank', [account('Lönekonto', 'payment', 42)])],
        removedBanks: [],
        syncing: null,
        lastSync: null,
      } satisfies AccountsResponse),
    );

    expect(page.textContent).not.toContain('Servern svarar');
    expect(page.querySelector('a[href="/transaktioner"]')).toBeNull();
  });

  describe('balances and syncing', () => {
    const swedbank = (
      accounts: ConnectedAccount[],
      syncing: SyncTrigger | null,
      lastSync: SyncSummary | null = null,
    ): AccountsResponse => ({
      banks: [group('Swedbank', accounts)],
      removedBanks: [],
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
            null,
          ),
        ),
      );

      const [first, second] = Array.from(page.querySelectorAll('section > ul > li'));
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
      expect(page.querySelector('[data-sync-status]')?.textContent).toContain(
        'Senast uppdaterad 10 nov. 13:00',
      );
    });

    it('keeps the accounts and keeps polling when a refresh fails during a sync', async () => {
      vi.useFakeTimers();
      try {
        const fixture = TestBed.createComponent(BankerPage);
        const http = TestBed.inject(HttpTestingController);
        await vi.advanceTimersByTimeAsync(0);
        http
          .expectOne('/api/accounts')
          .flush(swedbank([account('Lönekonto', 'payment')], 'initial'));
        await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
        http.expectOne('/api/accounts').error(new ProgressEvent('error'));
        await vi.advanceTimersByTimeAsync(0);
        const page = fixture.nativeElement as HTMLElement;
        expect(page.querySelector('[role=alert]')).toBeNull();
        expect(page.textContent).toContain('Lönekonto');
        expect(page.querySelector('[data-sync-status]')?.textContent).toContain('pågår');

        await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
        http.expectOne('/api/accounts').flush(swedbank([account('Lönekonto', 'payment')], null));
        await vi.advanceTimersByTimeAsync(0);
        expect(page.querySelector('[data-sync-status]')?.textContent).not.toContain('pågår');
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
        http
          .expectOne('/api/accounts')
          .flush(swedbank([account('Lönekonto', 'payment')], 'initial'));
        await vi.advanceTimersByTimeAsync(0);
        const page = fixture.nativeElement as HTMLElement;
        expect(page.querySelector('[data-sync-status]')?.textContent).toContain('pågår');
        expect(page.querySelector('[data-sync-status] svg')?.classList).toContain('animate-spin');

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
            null,
          ),
        );
        await vi.advanceTimersByTimeAsync(0);

        expect(page.querySelector('[data-sync-status]')?.textContent).not.toContain('pågår');
        expect(page.querySelector('[data-balance]')?.textContent?.trim()).toBe('89,00\u00a0kr');

        // Done: it stops asking.
        await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS * 3);
        http.expectNone('/api/accounts');
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['initial', 'Första uppdateringen pågår…'],
      ['scheduled', 'Uppdaterar…'],
      ['manual', 'Uppdaterar…'],
    ] as const)('names a running %s sync', async (trigger, text) => {
      const page = await render((request) =>
        request.flush(swedbank([account('Lönekonto', 'payment')], trigger)),
      );

      expect(page.querySelector('[data-sync-status]')?.textContent?.trim()).toBe(text);
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
      syncing: SyncTrigger | null,
      lastSync: SyncSummary | null = null,
      lastSyncedAt: string | null = null,
    ): AccountsResponse => ({
      banks: [group('Swedbank', [{ ...account('Lönekonto', 'payment'), lastSyncedAt }])],
      removedBanks: [],
      syncing,
      lastSync,
    });

    /** Renders the page showing an idle overview, with fake timers so polling can be stepped. */
    async function renderIdle(accounts: AccountsResponse = swedbank(null)) {
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
      http.expectOne('/api/accounts').flush(swedbank('manual'));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[data-sync-status]')?.textContent).toContain('Uppdaterar');
      expect(button()?.disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(SYNC_POLL_INTERVAL_MS);
      http
        .expectOne('/api/accounts')
        .flush(swedbank(null, summary({ newTransactions: 3 }), '2026-11-10T12:00:00.000Z'));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[data-sync-status]')?.textContent).toContain(
        'Uppdaterad nyss · 3 nya transaktioner',
      );
      expect(page.querySelector('[data-sync-status] svg')?.classList).not.toContain('animate-spin');
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
        http.expectOne('/api/accounts').flush(swedbank(null, summary({ newTransactions: count })));
        await vi.advanceTimersByTimeAsync(0);
        expect(page.querySelector('[data-sync-status]')?.textContent).toContain(text);
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
        .flush(swedbank(null, summary({ newTransactions: 2, failedAccounts: 1 })));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[role=alert]')?.textContent).toContain('1 konto kunde inte');
      expect(page.querySelector('[data-sync-status]')?.textContent).toContain(
        '2 nya transaktioner',
      );
    });

    it('explains a rate limit and shows when the data is from', async () => {
      const { page, http, button } = await renderIdle(
        swedbank(null, null, '2026-11-10T08:30:00.000Z'),
      );

      button()!.click();
      await vi.advanceTimersByTimeAsync(0);
      http.expectOne({ method: 'POST', url: '/api/sync' }).flush({ started: true });
      await vi.advanceTimersByTimeAsync(0);
      http
        .expectOne('/api/accounts')
        .flush(swedbank(null, summary({ rateLimited: true }), '2026-11-10T08:30:00.000Z'));
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
      http.expectOne('/api/accounts').flush(swedbank(null, summary({ newTransactions: 2 })));
      await vi.advanceTimersByTimeAsync(0);

      expect(page.querySelector('[data-sync-status]')?.textContent).toContain(
        '2 nya transaktioner',
      );
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
      const { button } = await renderIdle({
        banks: [],
        removedBanks: [],
        syncing: null,
        lastSync: null,
      });

      expect(button()).toBeNull();
    });
  });

  describe('connection expiry and renewal', () => {
    const DAY = 24 * 3600 * 1000;
    const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();
    const swedbank = (overrides: Partial<BankAccounts>) => (request: TestRequest) =>
      request.flush({
        banks: [group('Swedbank', [account('Lönekonto', 'payment')], overrides)],
        removedBanks: [],
        syncing: null,
        lastSync: null,
      } satisfies AccountsResponse);
    const renewButton = async (page: HTMLElement) => {
      page.querySelector<HTMLButtonElement>('[data-bank-menu]')?.click();
      await TestBed.inject(ApplicationRef).whenStable();
      return Array.from(page.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Förnya',
      );
    };

    it('shows the days left on a connection that is good for a while, without a warning', async () => {
      const page = await render(swedbank({ status: 'active', validUntil: inDays(60) }));

      expect(page.querySelector('[data-days-left]')?.textContent?.trim()).toBe('Giltig i 60 dagar');
      expect(page.querySelector('[data-validity]')?.textContent).toContain('t.o.m.');
      expect(page.querySelector('[data-expiry]')).toBeNull();
      expect(page.querySelector('.meter')?.classList).not.toContain('meter-warning');
      expect(page.querySelector('button[data-renew]:not([role])')).toBeNull();
    });

    it('lets the owner renew a connection that is still active', async () => {
      const page = await render(swedbank({ status: 'active', validUntil: inDays(60) }));
      const http = TestBed.inject(HttpTestingController);

      (await renewButton(page))!.click();
      const request = http.expectOne({ method: 'POST', url: '/api/connections' });
      expect(request.request.body).toEqual({ bank: 'Swedbank', renew: true });
      request.flush({ url: 'https://bankid.example/auth' });

      expect(redirects).toEqual(['https://bankid.example/auth']);
    });

    it('warns in Swedish when a connection is about to expire and offers to renew it', async () => {
      const page = await render(swedbank({ status: 'expiring', validUntil: inDays(10) }));

      const banner = page.querySelector('[data-expiry]');
      expect(banner?.textContent).toContain('Kopplingen till Swedbank går ut om 10 dagar.');
      expect(page.querySelector('[data-days-left]')?.textContent?.trim()).toBe(
        'Går ut om 10 dagar',
      );
      expect(page.querySelector('.meter')?.classList).toContain('meter-warning');
      expect(page.querySelector('button[data-renew]')?.classList).toContain('btn-primary');
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
      expect(page.querySelector('section > ul > li [data-not-syncing]')?.textContent?.trim()).toBe(
        'Uppdateras inte',
      );
      expect(page.querySelector('[data-days-left]')?.textContent?.trim()).toBe('Utgången');
      expect(page.querySelector('button[data-renew]')?.classList).toContain('btn-primary');
    });

    it('sends the owner to BankID to renew the same bank', async () => {
      const page = await render(swedbank({ status: 'expired' }));
      const http = TestBed.inject(HttpTestingController);

      (await renewButton(page))!.click();
      const request = http.expectOne({ method: 'POST', url: '/api/connections' });
      expect(request.request.body).toEqual({ bank: 'Swedbank' });
      request.flush({ url: 'https://bankid.example/auth' });

      expect(redirects).toEqual(['https://bankid.example/auth']);
    });

    it('says so when the renewal cannot be started', async () => {
      const page = await render(swedbank({ status: 'expired' }));
      const http = TestBed.inject(HttpTestingController);

      (await renewButton(page))!.click();
      http.expectOne({ method: 'POST', url: '/api/connections' }).error(new ProgressEvent('error'));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain(
        'Förnyelsen kunde inte startas',
      );
      expect(redirects).toEqual([]);
    });

    it('shows closed accounts apart from the others', async () => {
      const page = await render(
        swedbank({ closedAccounts: [account('Gammalt konto', 'savings', 9)] }),
      );

      const closed = page.querySelector('[data-closed-accounts]');
      expect(closed?.querySelector('h3')?.textContent?.trim()).toBe('Avslutade konton');
      expect(closed?.textContent).toContain('Gammalt konto');
      expect(closed?.textContent).toContain('Avslutat');
      expect(page.querySelector('section[data-bank] > ul')?.textContent).not.toContain(
        'Gammalt konto',
      );
    });
  });

  describe('hiding an account', () => {
    it('hides a shown account and fetches the accounts again', async () => {
      const response = (hidden: boolean): AccountsResponse => ({
        banks: [group('Swedbank', [{ ...account('Lönekonto', 'payment', 7), hidden }])],
        removedBanks: [],
        syncing: null,
        lastSync: null,
      });
      const page = await render((request) => request.flush(response(false)));
      const button = page.querySelector<HTMLButtonElement>('[data-toggle-hidden]');
      expect(button?.textContent?.trim()).toBe('Visas');
      expect(button?.getAttribute('aria-label')).toBe('Dölj kontot överallt');
      expect(button?.getAttribute('title')).toBe('Dölj kontot överallt');
      expect(page.querySelector('[data-hidden-row]')).toBeNull();

      button?.click();
      const http = TestBed.inject(HttpTestingController);
      const put = http.expectOne('/api/accounts/7/hidden');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ hidden: true });
      put.flush(null);
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne('/api/accounts').flush(response(true));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[data-hidden-row]')).not.toBeNull();
      const after = page.querySelector('[data-toggle-hidden]');
      expect(after?.textContent?.trim()).toBe('Dolt');
      expect(after?.getAttribute('aria-label')).toBe('Visa kontot igen');
      expect(after?.classList).toContain('border-dashed');
    });
  });

  describe('marking an account as a savings account', () => {
    it('marks it with the hint and sends the choice', async () => {
      const response = (savings: boolean): AccountsResponse => ({
        banks: [group('Swedbank', [{ ...account('Sparkonto', 'payment', 7), savings }])],
        removedBanks: [],
        syncing: null,
        lastSync: null,
      });
      const page = await render((request) => request.flush(response(false)));
      const box = page.querySelector<HTMLButtonElement>('[data-toggle-savings]');
      expect(box?.textContent?.trim()).toBe('Vanligt konto');
      expect(box?.getAttribute('title')).toContain('följ bara saldot');

      box?.click();
      const http = TestBed.inject(HttpTestingController);
      const put = http.expectOne('/api/accounts/7/savings');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ savings: true });
      put.flush(null);
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne('/api/accounts').flush(response(true));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[data-toggle-savings]')?.textContent?.trim()).toBe('Sparkonto');
      expect(page.querySelector('[data-account-name]')?.parentElement?.textContent).toContain(
        'Sparkonto',
      );
    });
  });

  describe('the share of an account', () => {
    const response = (share: ConnectedAccount['share']): AccountsResponse => ({
      banks: [group('Swedbank', [{ ...account('Coop Mastercard', 'card', 7), share }])],
      removedBanks: [],
      syncing: null,
      lastSync: null,
    });
    const pressed = (page: HTMLElement) =>
      page.querySelector('[aria-pressed=true][data-share]')?.getAttribute('data-share');
    const choose = (page: HTMLElement, option: string) =>
      page.querySelector<HTMLButtonElement>(`button[data-share=${option}]`)!.click();

    it('shows the options with the account’s share selected', async () => {
      const page = await render((request) => request.flush(response('half')));

      const options = [...page.querySelectorAll('button[data-share]')];
      expect(options.map((o) => o.textContent?.trim())).toEqual([
        'Jag',
        '50/50',
        'Hushåll',
        'Partner',
      ]);
      expect(pressed(page)).toBe('half');
    });

    it('saves a chosen share and fetches the accounts again', async () => {
      const page = await render((request) => request.flush(response('me')));

      choose(page, 'partner');
      const http = TestBed.inject(HttpTestingController);
      const put = http.expectOne('/api/accounts/7/share');
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual({ share: 'partner' });
      put.flush(null);
      await new Promise((resolve) => setTimeout(resolve));
      http.expectOne('/api/accounts').flush(response('partner'));
      await TestBed.inject(ApplicationRef).whenStable();

      expect(pressed(page)).toBe('partner');
    });

    it('says so when Hushåll cannot be chosen yet', async () => {
      const page = await render((request) => request.flush(response('me')));

      choose(page, 'household');
      const http = TestBed.inject(HttpTestingController);
      http
        .expectOne('/api/accounts/7/share')
        .flush({ message: 'no ratio' }, { status: 409, statusText: 'Conflict' });
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain('Hushåll');
      expect(pressed(page)).toBe('me');
    });
  });

  describe('removing a bank', () => {
    const response = (overrides: Partial<AccountsResponse> = {}): AccountsResponse => ({
      banks: [group('Swedbank', [account('Lönekonto', 'payment')])],
      removedBanks: [],
      syncing: null,
      lastSync: null,
      ...overrides,
    });
    const removeButton = async (page: HTMLElement) => {
      page.querySelector<HTMLButtonElement>('[data-bank-menu]')?.click();
      await TestBed.inject(ApplicationRef).whenStable();
      return page.querySelector<HTMLButtonElement>('[data-remove-bank]');
    };

    afterEach(() => vi.restoreAllMocks());

    it('removes the bank after the owner confirms and shows the page again', async () => {
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const page = await render((request) => request.flush(response()));
      const http = TestBed.inject(HttpTestingController);

      (await removeButton(page))!.click();
      expect(confirmation.mock.calls[0]![0]).toContain('historiken finns kvar');
      http.expectOne({ method: 'DELETE', url: '/api/connections/Swedbank' }).flush(null);
      await new Promise((resolve) => setTimeout(resolve));

      http.expectOne('/api/accounts').flush(
        response({
          banks: [],
          removedBanks: [{ bank: 'Swedbank', accounts: [account('Lönekonto', 'payment')] }],
        }),
      );
      await TestBed.inject(ApplicationRef).whenStable();
      expect(page.querySelector('[data-bank]')).toBeNull();
      page
        .querySelector<HTMLButtonElement>('[data-removed-banks] [data-disclosure-toggle]')!
        .click();
      await TestBed.inject(ApplicationRef).whenStable();
      expect(page.querySelector('[data-removed-bank="Swedbank"]')?.textContent).toContain(
        'Lönekonto',
      );
    });

    it('does nothing when the owner cancels', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const page = await render((request) => request.flush(response()));

      (await removeButton(page))!.click();

      TestBed.inject(HttpTestingController).expectNone('/api/connections/Swedbank');
    });

    it('asks per savings account whether to keep following its balance', async () => {
      const confirmation = vi
        .spyOn(window, 'confirm')
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      const first = { ...account('Sparkonto', 'savings'), id: 7, savings: true };
      const second = { ...account('ISK', 'savings'), id: 8, savings: true };
      const page = await render((request) =>
        request.flush(response({ banks: [group('Swedbank', [first, second])] })),
      );

      (await removeButton(page))!.click();

      expect(confirmation.mock.calls[1]![0]).toContain('Fortsätt följa saldot manuellt?');
      expect(confirmation.mock.calls[1]![0]).toContain('Sparkonto');
      expect(confirmation.mock.calls[2]![0]).toContain('ISK');
      TestBed.inject(HttpTestingController).expectOne({
        method: 'DELETE',
        url: '/api/connections/Swedbank?continueManually=7',
      });
    });

    it('says so when the bank could not be removed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const page = await render((request) => request.flush(response()));

      (await removeButton(page))!.click();
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'DELETE', url: '/api/connections/Swedbank' })
        .flush(null, { status: 500, statusText: 'Error' });
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte tas bort');
    });

    it('lists removed banks in a collapsed section where accounts can be hidden and shown', async () => {
      const hidden = { ...account('Dolt', 'payment', 2), hidden: true };
      const page = await render((request) =>
        request.flush(
          response({
            banks: [],
            removedBanks: [
              { bank: 'Swedbank', accounts: [account('Lönekonto', 'payment'), hidden] },
            ],
          }),
        ),
      );

      const section = page.querySelector<HTMLElement>('[data-removed-banks]')!;
      const toggle = section.querySelector<HTMLButtonElement>('[data-disclosure-toggle]')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(section.textContent).toContain('Borttagna banker');
      toggle.click();
      await TestBed.inject(ApplicationRef).whenStable();
      const rows = section.querySelectorAll('li');
      expect(rows[1]?.querySelector('[data-visibility]')?.textContent).toBe('Dolt');

      rows[1]!.querySelector<HTMLButtonElement>('[data-toggle-hidden]')!.click();
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'PUT', url: '/api/accounts/2/hidden' })
        .flush(null);
    });

    describe('deleting a removed bank for good', () => {
      const removedResponse = () =>
        response({
          banks: [],
          removedBanks: [{ bank: 'Swedbank', accounts: [account('Lönekonto', 'payment')] }],
        });
      const open = async (page: HTMLElement) => {
        page
          .querySelector<HTMLButtonElement>('[data-removed-banks] [data-disclosure-toggle]')!
          .click();
        await TestBed.inject(ApplicationRef).whenStable();
        page.querySelector<HTMLButtonElement>('[data-delete-bank]')!.click();
        await TestBed.inject(ApplicationRef).whenStable();
      };
      const type = async (page: HTMLElement, text: string) => {
        const input = page.querySelector<HTMLInputElement>('[data-delete-name]')!;
        input.value = text;
        input.dispatchEvent(new Event('input'));
        await TestBed.inject(ApplicationRef).whenStable();
      };
      const confirm = (page: HTMLElement) =>
        page.querySelector<HTMLButtonElement>('[data-confirm-delete]')!;

      it('erases the bank once its name is typed', async () => {
        const page = await render((request) => request.flush(removedResponse()));
        const http = TestBed.inject(HttpTestingController);

        await open(page);
        expect(page.querySelector('[data-delete-form]')?.textContent).toContain(
          'manuellt tas inte bort',
        );
        expect(confirm(page).disabled).toBe(true);
        await type(page, 'Swed');
        expect(confirm(page).disabled).toBe(true);
        await type(page, 'Swedbank');
        confirm(page).click();

        http
          .expectOne({ method: 'DELETE', url: '/api/connections/Swedbank/permanent' })
          .flush(null);
        await new Promise((resolve) => setTimeout(resolve));
        http.expectOne('/api/accounts').flush(response());
      });

      it('can be cancelled', async () => {
        const page = await render((request) => request.flush(removedResponse()));

        await open(page);
        page.querySelector<HTMLButtonElement>('[data-cancel-delete]')!.click();
        await TestBed.inject(ApplicationRef).whenStable();

        expect(page.querySelector('[data-delete-form]')).toBeNull();
        TestBed.inject(HttpTestingController).expectNone('/api/connections/Swedbank/permanent');
      });

      it('says so when it fails', async () => {
        const page = await render((request) => request.flush(removedResponse()));

        await open(page);
        await type(page, 'Swedbank');
        confirm(page).click();
        TestBed.inject(HttpTestingController)
          .expectOne('/api/connections/Swedbank/permanent')
          .flush(null, { status: 500, statusText: 'Error' });
        await TestBed.inject(ApplicationRef).whenStable();

        expect(page.querySelector('[role=alert]')?.textContent).toContain('tas bort helt');
      });
    });

    it('shows no Borttagna banker section when none were removed', async () => {
      const page = await render((request) => request.flush(response()));

      expect(page.querySelector('[data-removed-banks]')).toBeNull();
    });
  });

  it('shows an error when the accounts cannot be fetched', async () => {
    const page = await render(failed);

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
    expect(page.textContent).not.toContain('Inga banker anslutna');
  });
});
