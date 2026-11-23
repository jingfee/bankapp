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
import { BanksStore } from './stores/banks.store';
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
  const rail = (fixture: { nativeElement: unknown }) =>
    html(fixture).querySelector('[data-rail] nav') as HTMLElement;
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
      .filter((r) => !r.cancelled)
      .forEach((r) => r.flush({ count: reviewCount ?? 0 }));
    await fixture.whenStable();
  }

  it('has seven destinations in the sidebar, and five tabs with the rest under Mer', async () => {
    const fixture = TestBed.createComponent(App);
    for (const url of ['/', '/banker', '/anslut-bank']) {
      await navigate(fixture, url);
      const label = (a: Element) => a.textContent?.replace(/\d+/, '').trim();
      const side = [...sidebar(fixture).querySelectorAll('a')];
      expect(side.map(label)).toEqual([
        'Översikt',
        'Transaktioner',
        'Att granska',
        'Delat',
        'Sparande',
        'Bolån',
        'Banker',
      ]);
      expect(side.map((a) => a.getAttribute('href'))).toEqual([
        '/',
        '/transaktioner',
        '/granska',
        '/delat',
        '/sparande',
        '/bolan',
        '/banker',
      ]);
      const bar = tabs(fixture);
      // The fifth tab names the Mer page that is open, otherwise "Mer".
      expect([...bar.querySelectorAll('a, button')].map(label)).toEqual([
        'Översikt',
        'Transaktioner',
        'Granska',
        'Delat',
        url === '/' ? 'Mer' : 'Banker',
      ]);
    }
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('has all seven destinations in the rail, with a short label under each icon', async () => {
    const fixture = TestBed.createComponent(App);
    await navigate(fixture, '/');
    const links = [...rail(fixture).querySelectorAll('a')];
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Översikt',
      'Transaktioner',
      'Granska',
      'Delat',
      'Sparande',
      'Bolån',
      'Banker',
    ]);
    expect(html(fixture).querySelector('[data-rail] [data-more]')).toBeNull();
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('opens Ägare and Logga ut from the logo of the rail', async () => {
    const fixture = TestBed.createComponent(App);
    await navigate(fixture, '/');
    const menu = () => html(fixture).querySelector('[data-rail-menu]');
    expect(menu()).toBeNull();
    (html(fixture).querySelector('[data-rail-logo]') as HTMLElement).click();
    await fixture.whenStable();
    expect(menu()?.textContent).toContain('Ägare');
    expect(menu()?.querySelector('button[aria-label="Logga ut"]')).not.toBeNull();
    (html(fixture).querySelector('[data-rail-backdrop]') as HTMLElement).click();
    await fixture.whenStable();
    expect(menu()).toBeNull();
    TestBed.inject(HttpTestingController).match(() => true);
  });

  describe('Mer', () => {
    const more = (fixture: { nativeElement: unknown }) =>
      html(fixture).querySelector('[data-more]') as HTMLButtonElement;
    const sheet = (fixture: { nativeElement: unknown }) =>
      html(fixture).querySelector('[data-more-sheet]');

    it('opens a sheet with Sparande, Bolån and Banker, and closes on navigating', async () => {
      const fixture = TestBed.createComponent(App);
      await navigate(fixture, '/');
      expect(sheet(fixture)).toBeNull();
      more(fixture).click();
      await fixture.whenStable();
      const links = [...sheet(fixture)!.querySelectorAll('a')];
      expect(links.map((a) => a.textContent?.trim())).toEqual(['Sparande', 'Bolån', 'Banker']);
      (links[1] as HTMLAnchorElement).click();
      await navigate(fixture, '/bolan');
      expect(sheet(fixture)).toBeNull();
      TestBed.inject(HttpTestingController).match(() => true);
    });

    it('is a card above the tab bar with a handle, a title and the account row', async () => {
      const fixture = TestBed.createComponent(App);
      await navigate(fixture, '/');
      more(fixture).click();
      await fixture.whenStable();
      const card = sheet(fixture) as HTMLElement;
      expect(card.querySelector('[data-more-handle]')).not.toBeNull();
      expect(card.textContent).toContain('Mer');
      expect(card.textContent).toContain('Ägare');
      expect(card.querySelector('button[aria-label="Logga ut"]')).not.toBeNull();
      // Logga ut is not in the list of pages.
      expect(card.querySelectorAll('a')).toHaveLength(3);
      expect(card.className).toContain('rounded-2xl');
      expect(card.className).not.toContain('bottom-0 ');
      expect(html(fixture).querySelector('[data-more-backdrop]')?.className).toContain(
        'bg-black/60',
      );
      TestBed.inject(HttpTestingController).match(() => true);
    });

    it('shows "1 går ut" on Banker when a connection is expiring', async () => {
      const fixture = TestBed.createComponent(App);
      await navigate(fixture, '/');
      TestBed.inject(BanksStore).report({ lastSyncedAt: null, failed: false, expiring: 1 });
      more(fixture).click();
      await fixture.whenStable();
      expect(sheet(fixture)?.querySelector('[data-status-pill]')?.textContent).toBe('1 går ut');
      TestBed.inject(HttpTestingController).match(() => true);
    });

    it('closes on Escape', async () => {
      const fixture = TestBed.createComponent(App);
      await navigate(fixture, '/');
      more(fixture).click();
      await fixture.whenStable();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await fixture.whenStable();
      expect(sheet(fixture)).toBeNull();
      TestBed.inject(HttpTestingController).match(() => true);
    });

    it('closes from the backdrop', async () => {
      const fixture = TestBed.createComponent(App);
      await navigate(fixture, '/');
      more(fixture).click();
      await fixture.whenStable();
      (html(fixture).querySelector('[data-more-backdrop]') as HTMLElement).click();
      await fixture.whenStable();
      expect(sheet(fixture)).toBeNull();
      TestBed.inject(HttpTestingController).match(() => true);
    });

    it('is the active tab on the pages inside it, and no other tab is', async () => {
      const fixture = TestBed.createComponent(App);
      for (const [url, mer] of [
        ['/bolan', true],
        ['/sparande', true],
        ['/banker', true],
        ['/delat', false],
        ['/', false],
      ] as const) {
        await navigate(fixture, url);
        expect(more(fixture).classList.contains('active')).toBe(mer);
        expect(tabs(fixture).querySelectorAll('a.active').length).toBe(mer ? 0 : 1);
      }
      TestBed.inject(HttpTestingController).match(() => true);
    });
  });

  it('shows the brand and a logout button in the sidebar, and no global top bar', async () => {
    const fixture = TestBed.createComponent(App);
    await navigate(fixture, '/banker');

    expect(html(fixture).querySelector('aside')?.textContent).toContain('Bankapp');
    expect(html(fixture).querySelector('aside button[aria-label="Logga ut"]')).not.toBeNull();
    // Phones have the page's own sticky header instead.
    expect(html(fixture).querySelector('header:not([data-page-header])')).toBeNull();
    TestBed.inject(HttpTestingController).match(() => true);
  });

  it('highlights Banker on Anslut bank and its result, in every navigation', async () => {
    const fixture = TestBed.createComponent(App);
    for (const url of ['/anslut-bank', '/anslut-bank/resultat?status=ok&bank=SEB']) {
      await navigate(fixture, url);
      for (const nav of [sidebar(fixture), rail(fixture)]) {
        const current = [...nav.querySelectorAll('a.active')];
        expect(current).toHaveLength(1);
        expect(current[0].textContent).toContain('Banker');
      }
      expect(tabs(fixture).querySelector('[data-more]')?.textContent).toContain('Banker');
      expect(tabs(fixture).querySelectorAll('a.active')).toHaveLength(0);
    }
    TestBed.inject(HttpTestingController).match(() => true);
  });

  describe('sync status', () => {
    it('shows the last sync in the sidebar footer, amber when it failed, and Banker flagged', async () => {
      const fixture = TestBed.createComponent(App);
      const status = TestBed.inject(BanksStore);
      await navigate(fixture, '/');
      expect(html(fixture).querySelector('[data-sync-line]')).toBeNull();
      expect(html(fixture).querySelector('[data-attention]')).toBeNull();

      status.report({ lastSyncedAt: new Date().toISOString(), failed: false, expiring: 1 });
      await fixture.whenStable();
      const line = html(fixture).querySelector('aside [data-sync-line]');
      expect(line?.textContent).toMatch(/Uppdaterad idag \d\d:\d\d/);
      expect(line?.querySelector('[data-sync-dot]')?.classList.contains('bg-positive')).toBe(true);
      expect(sidebar(fixture).querySelector('a[href="/banker"] [data-attention]')).not.toBeNull();
      expect(rail(fixture).querySelector('a[href="/banker"] [data-attention]')).not.toBeNull();

      status.report({ lastSyncedAt: new Date().toISOString(), failed: true, expiring: 0 });
      await fixture.whenStable();
      const dot = html(fixture).querySelector('aside [data-sync-dot]');
      expect(dot?.classList.contains('bg-warning')).toBe(true);
      expect(html(fixture).querySelector('[data-attention]')).toBeNull();
      TestBed.inject(HttpTestingController).match(() => true);
    });
  });

  describe('sync status on start', () => {
    it('loads once after login, without visiting Banker', async () => {
      const fixture = TestBed.createComponent(App);
      const http = TestBed.inject(HttpTestingController);
      await navigate(fixture, '/');

      // Översikt asks for the accounts too; every answer carries the same status.
      const requests = http.match('/api/accounts');
      expect(requests.length).toBeGreaterThan(0);
      const body = {
        syncing: null,
        lastSync: null,
        banks: [
          {
            status: 'expired',
            accounts: [{ lastSyncedAt: new Date().toISOString() }],
          },
        ],
      };
      requests.forEach((request) => request.flush(body));
      await fixture.whenStable();

      expect(html(fixture).querySelector('aside [data-sync-line]')?.textContent).toMatch(
        /Uppdaterad idag \d\d:\d\d/,
      );
      expect(sidebar(fixture).querySelector('a[href="/banker"] [data-attention]')).not.toBeNull();
      http.match(() => true);
    });
  });

  describe('compact tabs', () => {
    it('wrap each label in .tab-label so narrow phones can hide the inactive ones', async () => {
      const fixture = TestBed.createComponent(App);
      await navigate(fixture, '/transaktioner');
      const labels = [...tabs(fixture).querySelectorAll('.tab-label')];
      expect(labels.map((l) => l.textContent?.trim())).toEqual([
        'Översikt',
        'Transaktioner',
        'Granska',
        'Delat',
        'Mer',
      ]);
      TestBed.inject(HttpTestingController).match(() => true);
    });
  });

  it('marks the item of the current route as active, in both navigations', async () => {
    const fixture = TestBed.createComponent(App);
    for (const [url, active] of [
      ['/', 'Översikt'],
      ['/transaktioner', 'Transaktioner'],
      ['/transaktioner/7', 'Transaktioner'],
      ['/bolan', 'Bolån'],
      ['/banker', 'Banker'],
      ['/delat', 'Delat'],
    ] as const) {
      await navigate(fixture, url);
      // Bolån and Banker have no tab; the Mer tab covers them (tested under Mer).
      const inMore = active === 'Bolån' || active === 'Banker';
      for (const nav of inMore
        ? [sidebar(fixture)]
        : [sidebar(fixture), rail(fixture), tabs(fixture)]) {
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
        for (const nav of [sidebar(fixture), rail(fixture), tabs(fixture)]) {
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

      for (const nav of [sidebar(fixture), rail(fixture), tabs(fixture)]) {
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

  it.each(['aside', '[data-rail-menu]', '[data-more-sheet]'])(
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
      if (where === '[data-rail-menu]') {
        (html.querySelector('[data-rail-logo]') as HTMLButtonElement).click();
        await fixture.whenStable();
      } else if (where !== 'aside') {
        (html.querySelector('[data-more]') as HTMLButtonElement).click();
        await fixture.whenStable();
      }

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
