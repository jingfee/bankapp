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
import { AccountsStore } from '../../stores/accounts.store';
import { FakeAccountsStore } from '../../stores/accounts.store.fake';
import { BanksStore } from '../../stores/banks.store';
import { FakeBanksStore } from '../../stores/banks.store.fake';
import { BankerPage } from './banker.page';

describe('BankerPage', () => {
  let redirects: string[];
  let accountsStore: FakeAccountsStore;
  let banksStore: FakeBanksStore;

  beforeEach(() => {
    redirects = [];
    accountsStore = new FakeAccountsStore();
    banksStore = new FakeBanksStore();
    TestBed.configureTestingModule({
      imports: [BankerPage],
      providers: [
        provideRouter([]),
        { provide: AccountsStore, useValue: accountsStore },
        { provide: BanksStore, useValue: banksStore },
        { provide: Redirector, useValue: { goTo: (url: string) => redirects.push(url) } },
      ],
    });
  });

  const stable = () => TestBed.inject(ApplicationRef).whenStable();

  /** Renders the page with what the accounts store holds, or with its failure. */
  async function render(accounts: AccountsResponse | 'failed' = noAccounts): Promise<HTMLElement> {
    if (accounts === 'failed') accountsStore.failed.set(true);
    else accountsStore.accounts.set(accounts);
    const fixture = TestBed.createComponent(BankerPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /** The store has fetched the accounts again. */
  async function fetched(accounts: AccountsResponse): Promise<void> {
    accountsStore.accounts.set(accounts);
    await stable();
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

  const noAccounts: AccountsResponse = {
    banks: [],
    removedBanks: [],
    syncing: null,
    lastSync: null,
  };

  it('has an empty state with a way to connect a bank', async () => {
    const page = await render();

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Banker');
    expect(page.textContent).toContain('Inga banker anslutna');
    const link = page.querySelector('a[href="/anslut-bank"]');
    expect(link?.textContent?.trim()).toBe('Anslut bank');
  });

  it('lists the accounts grouped by bank with their type', async () => {
    const page = await render({
      banks: [
        group('Coop Mastercard', [account('Coop Mastercard', 'card')]),
        group('Swedbank', [account('Lönekonto', 'payment'), account('Sparkonto', 'savings')]),
      ],
      removedBanks: [],
      syncing: null,
      lastSync: null,
    });

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
    const page = await render({
      banks: [group('Swedbank', [account('Lönekonto', 'payment', 42)])],
      removedBanks: [],
      syncing: null,
      lastSync: null,
    });

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
      banksStore.lastSyncedAt.set('2026-11-10T12:00:00.000Z');
      const page = await render(
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
      );

      const [first, second] = Array.from(page.querySelectorAll('section > ul > li'));
      expect(first?.querySelector('[data-balance]')?.textContent?.trim()).toBe(
        '−1\u00a0234,50\u00a0kr',
      );
      expect(first?.querySelector('[data-synced]')?.textContent?.trim()).toBe(
        'Uppdaterad 10 nov 13:00',
      );
      expect(second?.querySelector('[data-balance]')?.textContent?.trim()).toBe('–');
      expect(second?.querySelector('[data-synced]')?.textContent?.trim()).toBe(
        'Inte uppdaterad ännu',
      );
      expect(page.querySelector('[data-sync-status]')?.textContent).toContain(
        'Senast uppdaterad 10 nov 13:00',
      );
    });

    it('shows that a sync is running and updates when it has finished', async () => {
      const page = await render(swedbank([account('Lönekonto', 'payment')], 'initial'));
      expect(page.querySelector('[data-sync-status]')?.textContent).toContain('pågår');
      expect(page.querySelector('[data-sync-status] svg')?.classList).toContain('animate-spin');

      await fetched(
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

      expect(page.querySelector('[data-sync-status]')?.textContent).not.toContain('pågår');
      expect(page.querySelector('[data-balance]')?.textContent?.trim()).toBe('89,00\u00a0kr');
    });

    it.each([
      ['initial', 'Första uppdateringen pågår…'],
      ['scheduled', 'Uppdaterar…'],
      ['manual', 'Uppdaterar…'],
    ] as const)('names a running %s sync', async (trigger, text) => {
      const page = await render(swedbank([account('Lönekonto', 'payment')], trigger));

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

    /** Renders the page showing an idle overview. */
    async function renderIdle(accounts: AccountsResponse = swedbank(null)) {
      const page = await render(accounts);
      const button = () => page.querySelector<HTMLButtonElement>('button[data-sync]');
      return { page, button };
    }

    const syncStarts = () => banksStore.calls.filter((call) => call.method === 'startSync');

    it('starts a sync, shows progress and then how many transactions were new', async () => {
      const { page, button } = await renderIdle();
      expect(button()?.textContent?.trim()).toBe('Uppdatera');

      button()!.click();
      await stable();
      await fetched(swedbank('manual'));

      expect(syncStarts()).toHaveLength(1);
      expect(page.querySelector('[data-sync-status]')?.textContent).toContain('Uppdaterar');
      expect(button()?.disabled).toBe(true);

      await fetched(swedbank(null, summary({ newTransactions: 3 }), '2026-11-10T12:00:00.000Z'));

      expect(page.querySelector('[data-sync-status]')?.textContent).toContain(
        'Uppdaterad nyss · 3 nya transaktioner',
      );
      expect(page.querySelector('[data-sync-status] svg')?.classList).not.toContain('animate-spin');
      expect(button()?.disabled).toBe(false);
    });

    it('keeps waiting while the accounts shown are from before the sync started', async () => {
      const { page, button } = await renderIdle();

      button()!.click();
      await stable();

      expect(button()?.disabled).toBe(true);
      expect(page.querySelector('[data-sync-status]')?.textContent).not.toContain('nyss');
    });

    it('does not take the last sync for the new one', async () => {
      const old = summary({ newTransactions: 9 });
      const { page, button } = await renderIdle(swedbank(null, old));

      button()!.click();
      await stable();
      await fetched(swedbank(null, old));
      expect(button()?.disabled).toBe(true);
      expect(page.querySelector('[data-sync-status]')?.textContent).not.toContain('nyss');

      await fetched(swedbank('manual', old));
      await fetched(swedbank(null, old));
      expect(button()?.disabled).toBe(false);
    });

    it('says so when nothing was new, and uses the singular for one', async () => {
      const { page, button } = await renderIdle();

      for (const [count, text] of [
        [0, 'Inga nya transaktioner'],
        [1, '1 ny transaktion'],
      ] as const) {
        button()!.click();
        await stable();
        await fetched(
          swedbank(
            null,
            summary({ newTransactions: count, finishedAt: `2026-11-10T12:0${count}:00.000Z` }),
          ),
        );
        expect(page.querySelector('[data-sync-status]')?.textContent).toContain(text);
      }
    });

    it('mentions accounts the bank could not deliver', async () => {
      const { page, button } = await renderIdle();

      button()!.click();
      await stable();
      await fetched(swedbank(null, summary({ newTransactions: 2, failedAccounts: 1 })));

      expect(page.querySelector('[role=alert]')?.textContent).toContain('1 konto kunde inte');
      expect(page.querySelector('[data-sync-status]')?.textContent).toContain(
        '2 nya transaktioner',
      );
    });

    it('explains a rate limit and shows when the data is from', async () => {
      const { page, button } = await renderIdle(swedbank(null, null, '2026-11-10T08:30:00.000Z'));
      banksStore.lastSyncedAt.set('2026-11-10T08:30:00.000Z');

      button()!.click();
      await stable();
      await fetched(swedbank(null, summary({ rateLimited: true }), '2026-11-10T08:30:00.000Z'));

      const alert = page.querySelector('[role=alert]')?.textContent;
      expect(alert).toContain('Banken tillåter inte fler uppdateringar just nu');
      expect(alert).toContain('Senast uppdaterad 10 nov 09:30');
      expect(page.querySelector('[data-balance]')).not.toBeNull();
    });

    it('shows when the data is from, as the banks store reports it', async () => {
      banksStore.lastSyncedAt.set('2026-11-10T12:00:00.000Z');
      const { page } = await renderIdle();

      expect(page.querySelector('[data-sync-status]')?.textContent).toContain(
        'Senast uppdaterad 10 nov 13:00',
      );
    });

    it('shows an error when the sync cannot be started', async () => {
      banksStore.failures['startSync'] = new Error('no');
      const { page, button } = await renderIdle();

      button()!.click();
      await stable();

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
    const swedbank = (overrides: Partial<BankAccounts>): AccountsResponse => ({
      banks: [group('Swedbank', [account('Lönekonto', 'payment')], overrides)],
      removedBanks: [],
      syncing: null,
      lastSync: null,
    });
    const renewButton = async (page: HTMLElement) => {
      page.querySelector<HTMLButtonElement>('[data-bank-menu] [data-menu-trigger]')?.click();
      await stable();
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
      banksStore.responses['startConnection'] = 'https://bankid.example/auth';
      const page = await render(swedbank({ status: 'active', validUntil: inDays(60) }));

      (await renewButton(page))!.click();
      expect(banksStore.calls).toContainEqual({
        method: 'startConnection',
        args: ['Swedbank', true],
      });

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
      banksStore.responses['startConnection'] = 'https://bankid.example/auth';
      const page = await render(swedbank({ status: 'expired' }));

      (await renewButton(page))!.click();
      expect(banksStore.calls).toContainEqual({
        method: 'startConnection',
        args: ['Swedbank', false],
      });

      expect(redirects).toEqual(['https://bankid.example/auth']);
    });

    it('says so when the renewal cannot be started', async () => {
      banksStore.failures['startConnection'] = new Error('no');
      const page = await render(swedbank({ status: 'expired' }));

      (await renewButton(page))!.click();
      await stable();

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
    it('hides a shown account and shows it hidden when the accounts follow', async () => {
      const response = (hidden: boolean): AccountsResponse => ({
        banks: [group('Swedbank', [{ ...account('Lönekonto', 'payment', 7), hidden }])],
        removedBanks: [],
        syncing: null,
        lastSync: null,
      });
      const page = await render(response(false));
      const toggle = page.querySelector<HTMLInputElement>('[data-toggle-hidden]');
      expect(toggle?.getAttribute('role')).toBe('switch');
      expect(toggle?.classList).toContain('switch');
      expect(toggle?.checked).toBe(true);
      expect(page.querySelector('[data-hidden-row]')).toBeNull();

      toggle?.click();
      expect(accountsStore.calls).toEqual([{ method: 'setHidden', args: [7, true] }]);
      await fetched(response(true));

      expect(page.querySelector('[data-hidden-row]')).not.toBeNull();
      expect(page.querySelector<HTMLInputElement>('[data-toggle-hidden]')?.checked).toBe(false);
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
      const page = await render(response(false));
      const box = page.querySelector<HTMLInputElement>('[data-toggle-savings]');
      expect(box?.getAttribute('role')).toBe('switch');
      expect(box?.checked).toBe(false);
      expect(box?.closest('label')?.getAttribute('title')).toContain('Följ bara saldot');

      box?.click();
      expect(accountsStore.calls).toEqual([{ method: 'setSavings', args: [7, true] }]);
      await fetched(response(true));

      expect(page.querySelector<HTMLInputElement>('[data-toggle-savings]')?.checked).toBe(true);
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
      const page = await render(response('half'));

      const options = [...page.querySelectorAll('button[data-share]')];
      expect(options.map((o) => o.textContent?.trim())).toEqual([
        'Jag',
        '50/50',
        'Hushåll',
        'Partner',
      ]);
      expect(pressed(page)).toBe('half');
    });

    it('saves a chosen share and shows it when the accounts follow', async () => {
      const page = await render(response('me'));

      choose(page, 'partner');
      expect(accountsStore.calls).toEqual([{ method: 'setShare', args: [7, 'partner'] }]);
      await fetched(response('partner'));

      expect(pressed(page)).toBe('partner');
    });

    it('says so when Hushåll cannot be chosen yet', async () => {
      accountsStore.failures['setShare'] = { status: 409 };
      const page = await render(response('me'));

      choose(page, 'household');
      await stable();

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
      page.querySelector<HTMLButtonElement>('[data-bank-menu] [data-menu-trigger]')?.click();
      await stable();
      return page.querySelector<HTMLButtonElement>('[data-remove-bank]');
    };

    afterEach(() => vi.restoreAllMocks());

    const dialog = () => document.querySelector('[role=alertdialog]');
    const confirmButton = () =>
      document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-confirm]')!;

    it('removes the bank after the owner confirms and shows the page again', async () => {
      const page = await render(response());

      (await removeButton(page))!.click();
      await stable();
      expect(dialog()?.textContent).toContain('historiken finns kvar');
      expect(dialog()?.querySelector('[data-continue-account]')).toBeNull();
      expect(banksStore.calls).toEqual([]);
      confirmButton().click();
      expect(banksStore.calls).toEqual([{ method: 'remove', args: ['Swedbank', []] }]);

      await fetched(
        response({
          banks: [],
          removedBanks: [{ bank: 'Swedbank', accounts: [account('Lönekonto', 'payment')] }],
        }),
      );
      expect(dialog()).toBeNull();
      expect(page.querySelector('[data-bank]')).toBeNull();
      page
        .querySelector<HTMLButtonElement>('[data-removed-banks] [data-disclosure-toggle]')!
        .click();
      await stable();
      expect(page.querySelector('[data-removed-bank="Swedbank"]')?.textContent).toContain(
        'Lönekonto',
      );
    });

    it('does nothing when the owner cancels', async () => {
      const page = await render(response());

      (await removeButton(page))!.click();
      await stable();
      document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-cancel]')!.click();
      await stable();

      expect(dialog()).toBeNull();
      expect(banksStore.calls).toEqual([]);
    });

    describe('with savings accounts', () => {
      const first = { ...account('Sparkonto', 'savings'), id: 7, savings: true };
      const second = { ...account('ISK', 'savings'), id: 8, savings: true };
      const open = async () => {
        const page = await render(response({ banks: [group('Swedbank', [first, second])] }));
        (await removeButton(page))!.click();
        await stable();
        return page;
      };
      const boxes = () =>
        Array.from(
          document.querySelectorAll<HTMLInputElement>('[role=alertdialog] [data-continue-account]'),
        );

      it('asks once, with a checkbox per savings account that is checked by default', async () => {
        await open();

        expect(document.querySelectorAll('[role=alertdialog]')).toHaveLength(1);
        expect(boxes().map((box) => box.checked)).toEqual([true, true]);
        expect(dialog()?.textContent).toContain('Sparkonto');
        expect(dialog()?.textContent).toContain('ISK');
        confirmButton().click();
        expect(banksStore.calls).toEqual([{ method: 'remove', args: ['Swedbank', [7, 8]] }]);
      });

      it('closes the savings account that was unchecked', async () => {
        await open();

        boxes()[1]!.click();
        await stable();
        confirmButton().click();
        expect(banksStore.calls).toEqual([{ method: 'remove', args: ['Swedbank', [7]] }]);
      });
    });

    it('says so when the bank could not be removed', async () => {
      banksStore.failures['remove'] = new Error('no');
      const page = await render(response());

      (await removeButton(page))!.click();
      await stable();
      confirmButton().click();
      await stable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte tas bort');
    });

    it('lists removed banks in a collapsed section where accounts can be hidden and shown', async () => {
      const hidden = { ...account('Dolt', 'payment', 2), hidden: true };
      const page = await render(
        response({
          banks: [],
          removedBanks: [{ bank: 'Swedbank', accounts: [account('Lönekonto', 'payment'), hidden] }],
        }),
      );

      const section = page.querySelector<HTMLElement>('[data-removed-banks]')!;
      const toggle = section.querySelector<HTMLButtonElement>('[data-disclosure-toggle]')!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(section.textContent).toContain('Borttagna banker');
      toggle.click();
      await stable();
      const rows = section.querySelectorAll('li');
      const switches = (row: Element) =>
        row.querySelector<HTMLInputElement>('[data-toggle-hidden]');
      expect(switches(rows[0]!)?.checked).toBe(true);
      expect(switches(rows[1]!)?.checked).toBe(false);

      switches(rows[1]!)!.click();
      expect(accountsStore.calls).toEqual([{ method: 'setHidden', args: [2, false] }]);
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
        await stable();
        page.querySelector<HTMLButtonElement>('[data-delete-bank]')!.click();
        await stable();
      };
      const type = async (text: string) => {
        const input = document.querySelector<HTMLInputElement>('[data-delete-name]')!;
        input.value = text;
        input.dispatchEvent(new Event('input'));
        await stable();
      };
      const confirm = () => confirmButton();

      it('erases the bank once its name is typed', async () => {
        const page = await render(removedResponse());

        await open(page);
        expect(dialog()?.textContent).toContain('manuellt tas inte bort');
        expect(dialog()?.querySelector('[data-confirm]')?.classList).toContain('btn-danger');
        expect(confirm().disabled).toBe(true);
        await type('Swed');
        expect(confirm().disabled).toBe(true);
        await type('Swedbank');
        confirm().click();

        expect(banksStore.calls).toEqual([{ method: 'deleteForGood', args: ['Swedbank'] }]);
        await fetched(response());
        expect(dialog()).toBeNull();
      });

      it('can be cancelled', async () => {
        const page = await render(removedResponse());

        await open(page);
        document.querySelector<HTMLButtonElement>('[role=alertdialog] [data-cancel]')!.click();
        await stable();

        expect(dialog()).toBeNull();
        expect(banksStore.calls).toEqual([]);
      });

      it('says so when it fails', async () => {
        banksStore.failures['deleteForGood'] = new Error('no');
        const page = await render(removedResponse());

        await open(page);
        await type('Swedbank');
        confirm().click();
        await stable();

        expect(page.querySelector('[role=alert]')?.textContent).toContain('tas bort helt');
      });
    });

    it('shows no Borttagna banker section when none were removed', async () => {
      const page = await render(response());

      expect(page.querySelector('[data-removed-banks]')).toBeNull();
    });
  });

  it('tries again when the first fetch failed and the owner comes back', async () => {
    await render('failed');

    expect(accountsStore.calls).toContainEqual({ method: 'reload', args: [] });
  });

  it('shows an error when the accounts cannot be fetched', async () => {
    const page = await render('failed');

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
    expect(page.textContent).not.toContain('Inga banker anslutna');
  });
});
