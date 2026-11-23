import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import type { AccountsResponse, Bank } from '@bankapp/shared';
import { Redirector } from '../../redirector';
import { AccountsStore } from '../../stores/accounts.store';
import { FakeAccountsStore } from '../../stores/accounts.store.fake';
import { BanksStore } from '../../stores/banks.store';
import { FakeBanksStore } from '../../stores/banks.store.fake';
import { ConnectBankPage } from './connect-bank.page';

describe('ConnectBankPage', () => {
  let redirects: string[];
  let banksStore: FakeBanksStore;
  let accountsStore: FakeAccountsStore;

  beforeEach(() => {
    redirects = [];
    banksStore = new FakeBanksStore();
    accountsStore = new FakeAccountsStore();
    TestBed.configureTestingModule({
      imports: [ConnectBankPage],
      providers: [
        provideRouter([]),
        { provide: BanksStore, useValue: banksStore },
        { provide: AccountsStore, useValue: accountsStore },
        { provide: Redirector, useValue: { goTo: (url: string) => redirects.push(url) } },
      ],
    });
  });

  const banks: Bank[] = [
    { name: 'Northmill', logoUrl: null, beta: true },
    { name: 'Skandia', logoUrl: 'https://logos.example/skandia.png', beta: false },
    { name: 'Swedbank', logoUrl: null, beta: false },
  ];

  async function render(setUp: () => void = () => banksStore.available.set(banks)) {
    setUp();
    const fixture = TestBed.createComponent(ConnectBankPage);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      page,
      names: () =>
        Array.from(page.querySelectorAll('li [data-bank-name]')).map(
          (name) => name.textContent?.trim() ?? '',
        ),
      async choose(name: string) {
        const button = Array.from(page.querySelectorAll('button')).find(
          (candidate) => candidate.textContent?.trim() === name,
        )!;
        button.click();
        await fixture.whenStable();
      },
      async type(text: string) {
        const input = page.querySelector('input')!;
        input.value = text;
        input.dispatchEvent(new Event('input'));
        await fixture.whenStable();
      },
    };
  }

  it('lists the banks and marks beta banks', async () => {
    const { page, names } = await render();

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Anslut bank');
    expect(names()).toEqual(['Northmill', 'Skandia', 'Swedbank']);
    expect(page.querySelectorAll('li')[0]?.textContent).toContain('Beta');
    expect(page.textContent?.match(/Beta/g)).toHaveLength(1);
  });

  it('shows a monogram when a bank has no logo and the logo when it has one', async () => {
    const { page } = await render();

    const rows = page.querySelectorAll('li');
    expect(rows[0]?.querySelector('[data-monogram]')?.textContent?.trim()).toBe('N');
    expect(rows[1]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://logos.example/skandia.png',
    );
    expect(rows[1]?.querySelector('[data-monogram]')).toBeNull();
    expect(page.querySelectorAll('li > button')).toHaveLength(3);
  });

  it('marks banks that already have an active connection', async () => {
    const { page } = await render(() => {
      banksStore.available.set(banks);
      accountsStore.accounts.set({
        banks: [{ bank: 'Skandia', status: 'active', accounts: [], closedAccounts: [] }],
      } as unknown as AccountsResponse);
    });

    const marked = Array.from(page.querySelectorAll('li')).filter((li) =>
      li.querySelector('[data-connected]'),
    );
    expect(marked.map((li) => li.textContent)).toEqual([expect.stringContaining('Skandia')]);
    expect(marked[0]?.textContent).toContain('Ansluten');
  });

  it('filters the banks as the owner types, ignoring case', async () => {
    const { names, type } = await render();

    await type('SW');

    expect(names()).toEqual(['Swedbank']);
  });

  it('says so when no bank matches', async () => {
    const { page, names, type } = await render();

    await type('zzz');

    expect(names()).toEqual([]);
    expect(page.textContent).toContain('Ingen bank matchar');
  });

  it('explains when the bank list is still empty', async () => {
    const { page } = await render(() => banksStore.available.set([]));

    expect(page.textContent).toContain('Inga banker hittades ännu');
  });

  it('shows an error when the list cannot be fetched', async () => {
    const { page } = await render(() => banksStore.availableFailed.set(true));

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
  });

  it('shows the list for as long as the page is open', async () => {
    const { fixture } = await render();
    expect(banksStore.calls.map((c) => c.method)).toEqual(['activateAvailable']);
    fixture.destroy();
    expect(banksStore.calls.map((c) => c.method)).toEqual([
      'activateAvailable',
      'deactivateAvailable',
    ]);
  });

  it('shows a skeleton while the list is being fetched', async () => {
    const { page } = await render(() => banksStore.availableLoading.set(true));
    expect(page.querySelector('[aria-busy=true]')).not.toBeNull();
  });

  describe('choosing a bank', () => {
    it('starts the connection and sends the owner to BankID', async () => {
      banksStore.responses['startConnection'] = 'https://bankid.example/go';
      const { choose } = await render();

      await choose('Skandia');

      expect(banksStore.calls.find((c) => c.method === 'startConnection')?.args[0]).toBe('Skandia');
      expect(redirects).toEqual(['https://bankid.example/go']);
    });

    it('shows an error and stays put when the connection cannot be started', async () => {
      banksStore.failures['startConnection'] = new HttpErrorResponse({ status: 500 });
      const { page, choose } = await render();

      await choose('Skandia');
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain(
        'Anslutningen kunde inte startas',
      );
      expect(redirects).toEqual([]);
    });

    it('says so when the bank is already connected', async () => {
      banksStore.failures['startConnection'] = new HttpErrorResponse({ status: 409 });
      const { page, choose } = await render();

      await choose('Skandia');
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain('redan ansluten');
    });
  });
});
