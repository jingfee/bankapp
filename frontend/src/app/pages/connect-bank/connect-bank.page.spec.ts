import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Bank, BanksResponse, StartConnectionResponse } from '@bankapp/shared';
import type { AccountsResponse } from '@bankapp/shared';
import { Redirector } from '../../redirector';
import { ConnectBankPage } from './connect-bank.page';

describe('ConnectBankPage', () => {
  let redirects: string[];

  beforeEach(() => {
    redirects = [];
    TestBed.configureTestingModule({
      imports: [ConnectBankPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: Redirector, useValue: { goTo: (url: string) => redirects.push(url) } },
      ],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const banks: Bank[] = [
    { name: 'Northmill', logoUrl: null, beta: true },
    { name: 'Skandia', logoUrl: 'https://logos.example/skandia.png', beta: false },
    { name: 'Swedbank', logoUrl: null, beta: false },
  ];

  let accountsResponse: Partial<AccountsResponse>;
  beforeEach(() => (accountsResponse = { banks: [] }));

  async function render(respond: (request: TestRequest) => void) {
    const fixture = TestBed.createComponent(ConnectBankPage);
    await fixture.whenStable();
    respond(TestBed.inject(HttpTestingController).expectOne('/api/banks'));
    TestBed.inject(HttpTestingController).expectOne('/api/accounts').flush(accountsResponse);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    return {
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

  const withBanks = (request: TestRequest) => request.flush({ banks } satisfies BanksResponse);

  it('lists the banks and marks beta banks', async () => {
    const { page, names } = await render(withBanks);

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Anslut bank');
    expect(names()).toEqual(['Northmill', 'Skandia', 'Swedbank']);
    expect(page.querySelectorAll('li')[0]?.textContent).toContain('Beta');
    expect(page.textContent?.match(/Beta/g)).toHaveLength(1);
  });

  it('shows a monogram when a bank has no logo and the logo when it has one', async () => {
    const { page } = await render(withBanks);

    const rows = page.querySelectorAll('li');
    expect(rows[0]?.querySelector('[data-monogram]')?.textContent?.trim()).toBe('N');
    expect(rows[1]?.querySelector('img')?.getAttribute('src')).toBe(
      'https://logos.example/skandia.png',
    );
    expect(rows[1]?.querySelector('[data-monogram]')).toBeNull();
    expect(page.querySelectorAll('li > button')).toHaveLength(3);
  });

  it('marks banks that already have an active connection', async () => {
    accountsResponse = {
      banks: [{ bank: 'Skandia', status: 'active', accounts: [], closedAccounts: [] }],
    } as unknown as Partial<AccountsResponse>;
    const { page } = await render(withBanks);

    const marked = Array.from(page.querySelectorAll('li')).filter((li) =>
      li.querySelector('[data-connected]'),
    );
    expect(marked.map((li) => li.textContent)).toEqual([expect.stringContaining('Skandia')]);
    expect(marked[0]?.textContent).toContain('Ansluten');
  });

  it('filters the banks as the owner types, ignoring case', async () => {
    const { names, type } = await render(withBanks);

    await type('SW');

    expect(names()).toEqual(['Swedbank']);
  });

  it('says so when no bank matches', async () => {
    const { page, names, type } = await render(withBanks);

    await type('zzz');

    expect(names()).toEqual([]);
    expect(page.textContent).toContain('Ingen bank matchar');
  });

  it('explains when the bank list is still empty', async () => {
    const { page } = await render((request) => request.flush({ banks: [] }));

    expect(page.textContent).toContain('Inga banker hittades ännu');
  });

  it('shows an error when the list cannot be fetched', async () => {
    const { page } = await render((request) => request.error(new ProgressEvent('error')));

    expect(page.querySelector('[role=alert]')?.textContent).toContain('kunde inte hämtas');
  });

  describe('choosing a bank', () => {
    const answerStart = (request: TestRequest) =>
      request.flush({ url: 'https://bankid.example/go' } satisfies StartConnectionResponse);

    it('starts the connection and sends the owner to BankID', async () => {
      const { choose } = await render(withBanks);

      await choose('Skandia');
      const request = TestBed.inject(HttpTestingController).expectOne('/api/connections');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ bank: 'Skandia' });
      answerStart(request);

      expect(redirects).toEqual(['https://bankid.example/go']);
    });

    it('shows an error and stays put when the connection cannot be started', async () => {
      const { page, choose } = await render(withBanks);

      await choose('Skandia');
      TestBed.inject(HttpTestingController)
        .expectOne('/api/connections')
        .flush({}, { status: 500, statusText: 'Server Error' });
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain(
        'Anslutningen kunde inte startas',
      );
      expect(redirects).toEqual([]);
    });

    it('says so when the bank is already connected', async () => {
      const { page, choose } = await render(withBanks);

      await choose('Skandia');
      TestBed.inject(HttpTestingController)
        .expectOne('/api/connections')
        .flush({}, { status: 409, statusText: 'Conflict' });
      await TestBed.inject(ApplicationRef).whenStable();

      expect(page.querySelector('[role=alert]')?.textContent).toContain('redan ansluten');
    });
  });
});
