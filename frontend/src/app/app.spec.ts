import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    });
  });

  it('shows a header with the name and a Banker link on every page', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    for (const url of ['/', '/banker', '/anslut-bank']) {
      await router.navigateByUrl(url);
      await fixture.whenStable();
      const header = (fixture.nativeElement as HTMLElement).querySelector('header');
      expect(header?.textContent).toContain('Bankapp');
      expect(header?.querySelector('a[href="/banker"]')?.getAttribute('aria-label')).toBe('Banker');
    }
  });

  describe('Granska icon', () => {
    const header = (fixture: { nativeElement: unknown }) =>
      (fixture.nativeElement as HTMLElement).querySelector('header') as HTMLElement;

    it('is in the header on every page, with the count as a badge', async () => {
      const fixture = TestBed.createComponent(App);
      const router = TestBed.inject(Router);
      const http = TestBed.inject(HttpTestingController);
      for (const url of ['/', '/banker', '/anslut-bank']) {
        await router.navigateByUrl(url);
        http.match('/api/transactions/review/count').forEach((r) => r.flush({ count: 3 }));
        await fixture.whenStable();
        const link = header(fixture).querySelector('a[href="/granska"]');
        expect(link?.getAttribute('aria-label')).toBe('Granska, 3 att granska');
        expect(link?.querySelector('[data-review-badge]')?.textContent?.trim()).toBe('3');
      }
      http.match(() => true);
    });

    it('has no badge when nothing needs review', async () => {
      const fixture = TestBed.createComponent(App);
      const http = TestBed.inject(HttpTestingController);
      await TestBed.inject(Router).navigateByUrl('/banker');
      http.match('/api/transactions/review/count').forEach((r) => r.flush({ count: 0 }));
      await fixture.whenStable();

      const link = header(fixture).querySelector('a[href="/granska"]');
      expect(link?.getAttribute('aria-label')).toBe('Granska');
      expect(link?.querySelector('[data-review-badge]')).toBeNull();
      http.match(() => true);
    });
  });

  it('starts on the transactions and has a Banker page of its own', async () => {
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

  it('redirects /transaktioner to the start page', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/transaktioner');

    expect(TestBed.inject(Router).url).toBe('/');
    TestBed.inject(HttpTestingController).match(() => true);
  });
});
