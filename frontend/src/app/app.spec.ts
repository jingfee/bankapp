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

  it('starts on the transactions and has a Banker page of its own', async () => {
    const router = TestBed.inject(Router);
    const title = TestBed.inject(Title);

    await router.navigateByUrl('/');
    expect(title.getTitle()).toBe('Bankapp');
    await router.navigateByUrl('/banker');
    expect(title.getTitle()).toBe('Banker – Bankapp');
  });

  it('redirects /transaktioner to the start page', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/transaktioner');

    expect(TestBed.inject(Router).url).toBe('/');
    TestBed.inject(HttpTestingController).match(() => true);
  });
});
