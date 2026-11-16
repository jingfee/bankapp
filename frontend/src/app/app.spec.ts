import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { App } from './app';
import { AuthService } from './auth/auth.service';
import { routes } from './app.routes';
import { ToastService } from './toast/toast.service';

describe('App', () => {
  const signedIn = { check: () => of(true), logout: () => of(undefined) };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        // Signed in; the guard and the login page have their own tests.
        { provide: AuthService, useValue: signedIn },
      ],
    });
  });

  const html = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;
  const sidebar = (fixture: { nativeElement: unknown }) =>
    html(fixture).querySelector('aside nav') as HTMLElement;
  const tabs = (fixture: { nativeElement: unknown }) =>
    html(fixture).querySelector('[data-tabs]') as HTMLElement;

  async function navigate(
    fixture: { whenStable: () => Promise<unknown> },
    url: string,
    reviewCount?: number,
  ) {
    await TestBed.inject(Router).navigateByUrl(url);
    const http = TestBed.inject(HttpTestingController);
    http
      .match('/api/transactions/review/count')
      .forEach((r) => r.flush({ count: reviewCount ?? 0 }));
    await fixture.whenStable();
  }

  it('has the five destinations in the sidebar and the bottom tabs, on every page', async () => {
    const fixture = TestBed.createComponent(App);
    for (const url of ['/', '/banker', '/anslut-bank']) {
      await navigate(fixture, url);
      for (const [nav, labels] of [
        [sidebar(fixture), ['Översikt', 'Transaktioner', 'Att granska', 'Delat', 'Banker']],
        [tabs(fixture), ['Översikt', 'Transaktioner', 'Granska', 'Delat', 'Banker']],
      ] as const) {
        const links = [...nav.querySelectorAll('a')];
        expect(links.map((a) => a.textContent?.replace(/\d+/, '').trim())).toEqual([...labels]);
        expect(links.map((a) => a.getAttribute('href'))).toEqual([
          '/',
          '/transaktioner',
          '/granska',
          '/delat',
          '/banker',
        ]);
      }
    }
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('shows the brand and a logout button in the sidebar, and the brand in a mobile header', async () => {
    const fixture = TestBed.createComponent(App);
    await navigate(fixture, '/banker');

    expect(html(fixture).querySelector('aside')?.textContent).toContain('Bankapp');
    expect(html(fixture).querySelector('aside button[aria-label="Logga ut"]')).not.toBeNull();
    const header = html(fixture).querySelector('header') as HTMLElement;
    expect(header.textContent).toContain('Bankapp');
    expect(header.querySelector('button[aria-label="Logga ut"]')).not.toBeNull();
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('marks the item of the current route as active, in both navigations', async () => {
    const fixture = TestBed.createComponent(App);
    for (const [url, active] of [
      ['/', 'Översikt'],
      ['/transaktioner', 'Transaktioner'],
      ['/transaktioner/7', 'Transaktioner'],
      ['/banker', 'Banker'],
      ['/delat', 'Delat'],
    ] as const) {
      await navigate(fixture, url);
      for (const nav of [sidebar(fixture), tabs(fixture)]) {
        const current = [...nav.querySelectorAll('a.active')];
        expect(current).toHaveLength(1);
        expect(current[0].textContent).toContain(active);
        expect(current[0].getAttribute('aria-current')).toBe('page');
      }
    }
    TestBed.inject(HttpTestingController).match(() => true);
  });

  describe('Granska count', () => {
    it('is a badge on Granska in the sidebar and on its tab', async () => {
      const fixture = TestBed.createComponent(App);
      for (const url of ['/', '/banker', '/anslut-bank']) {
        await navigate(fixture, url, 3);
        for (const nav of [sidebar(fixture), tabs(fixture)]) {
          const link = nav.querySelector('a[href="/granska"]');
          expect(link?.getAttribute('aria-label')).toBe('Granska, 3 att granska');
          expect(link?.querySelector('[data-review-badge]')?.textContent?.trim()).toBe('3');
        }
      }
      TestBed.inject(HttpTestingController).match(() => true);
    });

    it('is capped at 99+', async () => {
      const fixture = TestBed.createComponent(App);
      await navigate(fixture, '/banker', 250);

      const badge = tabs(fixture).querySelector('[data-review-badge]');
      expect(badge?.textContent?.trim()).toBe('99+');
      TestBed.inject(HttpTestingController).match(() => true);
    });

    it('has no badge when nothing needs review', async () => {
      const fixture = TestBed.createComponent(App);
      await navigate(fixture, '/banker', 0);

      for (const nav of [sidebar(fixture), tabs(fixture)]) {
        const link = nav.querySelector('a[href="/granska"]');
        expect(link?.getAttribute('aria-label')).toBe('Granska');
        expect(link?.querySelector('[data-review-badge]')).toBeNull();
      }
      TestBed.inject(HttpTestingController).match(() => true);
    });
  });

  it('shows a toast from the ToastService', async () => {
    const fixture = TestBed.createComponent(App);
    await navigate(fixture, '/banker');

    TestBed.inject(ToastService).show('Sparat');
    await fixture.whenStable();

    expect(html(fixture).querySelector('[data-toast]')?.textContent).toContain('Sparat');
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('starts on the overview and has a Banker page of its own', async () => {
    const router = TestBed.inject(Router);
    const title = TestBed.inject(Title);

    await router.navigateByUrl('/');
    expect(title.getTitle()).toBe('Bankapp');
    await router.navigateByUrl('/banker');
    expect(title.getTitle()).toBe('Banker – Bankapp');
    await router.navigateByUrl('/granska');
    expect(title.getTitle()).toBe('Att granska – Bankapp');
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('shows the overview at / and the transaction list at /transaktioner', async () => {
    const harness = await RouterTestingHarness.create();
    const http = TestBed.inject(HttpTestingController);
    const title = TestBed.inject(Title);

    await harness.navigateByUrl('/');
    expect(http.match((r) => r.url === '/api/overview').length).toBeGreaterThan(0);
    expect(title.getTitle()).toBe('Bankapp');
    http.match(() => true);

    await harness.navigateByUrl('/transaktioner');
    expect(TestBed.inject(Router).url).toBe('/transaktioner');
    expect(title.getTitle()).toBe('Transaktioner – Bankapp');
    expect(http.match((r) => r.url === '/api/transactions').length).toBeGreaterThan(0);
    expect(http.match((r) => r.url === '/api/accounts')).toHaveLength(0);
    http.match(() => true);
  });
});

describe('App logout', () => {
  let logouts: number;

  beforeEach(() => {
    logouts = 0;
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        {
          provide: AuthService,
          useValue: {
            check: () => of(true),
            logout: () => {
              logouts++;
              return of(undefined);
            },
          },
        },
      ],
    });
  });

  it.each(['aside', 'header'])(
    'signs out from the %s button and shows the login page',
    async (where) => {
      const fixture = TestBed.createComponent(App);
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/banker');
      TestBed.inject(HttpTestingController)
        .match('/api/transactions/review/count')
        .forEach((r) => r.flush({ count: 0 }));
      await fixture.whenStable();
      const html = fixture.nativeElement as HTMLElement;

      (html.querySelector(`${where} button[aria-label="Logga ut"]`) as HTMLButtonElement).click();
      await fixture.whenStable();

      expect(logouts).toBe(1);
      expect(router.url).toBe('/logga-in');
      // The login page has no navigation around it.
      expect(html.querySelector('aside')).toBeNull();
      expect(html.querySelector('[data-tabs]')).toBeNull();
      expect(html.querySelector('input[name="password"]')).not.toBeNull();
    },
  );
});

describe('App logout failure', () => {
  it('stays put and says so when the server could not end the session', async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter(routes),
        {
          provide: AuthService,
          useValue: { check: () => of(true), logout: () => throwError(() => new Error('offline')) },
        },
      ],
    });
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/banker');
    TestBed.inject(HttpTestingController)
      .match('/api/transactions/review/count')
      .forEach((r) => r.flush({ count: 0 }));
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;

    (html.querySelector('aside button[aria-label="Logga ut"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(router.url).toBe('/banker');
    expect(html.querySelector('[data-toast]')?.textContent).toContain('Det gick inte att logga ut');
  });
});
