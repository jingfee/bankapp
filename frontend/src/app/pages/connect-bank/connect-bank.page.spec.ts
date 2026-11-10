import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  type TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Bank, BanksResponse } from '@bankapp/shared';
import { ConnectBankPage } from './connect-bank.page';

describe('ConnectBankPage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConnectBankPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const banks: Bank[] = [
    { name: 'Northmill', logoUrl: null, beta: true },
    { name: 'Skandia', logoUrl: 'https://logos.example/skandia.png', beta: false },
    { name: 'Swedbank', logoUrl: null, beta: false },
  ];

  async function render(respond: (request: TestRequest) => void) {
    const fixture = TestBed.createComponent(ConnectBankPage);
    await fixture.whenStable();
    respond(TestBed.inject(HttpTestingController).expectOne('/api/banks'));
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    return {
      page,
      names: () =>
        Array.from(page.querySelectorAll('li')).map((li) => li.textContent?.trim() ?? ''),
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
    expect(names()).toEqual(['NorthmillBeta', 'Skandia', 'Swedbank']);
    expect(page.querySelectorAll('li')[0]?.textContent).toContain('Beta');
    expect(page.textContent?.match(/Beta/g)).toHaveLength(1);
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
});
