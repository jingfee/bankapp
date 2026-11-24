import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import configJson from '../../ngsw-config.json';
import { matches } from '../pwa/glob.testing';
import { OfflineWarmup } from './offline-warmup.service';

@Component({ template: '' })
class Blank {}

describe('warming up saved data', () => {
  let http: HttpTestingController;
  let warmup: OfflineWarmup;

  beforeEach(() => {
    // 24 November 2026: this month is 2026-11 and the one before is 2026-10.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 24, 12));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'logga-in', component: Blank },
          { path: '**', component: Blank },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    warmup = TestBed.inject(OfflineWarmup);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  /** Every GET asked for since the last call, as `url?query`, and answered so nothing stays open. */
  function fetched(): string[] {
    const requests = http.match(() => true);
    requests.forEach((request) => request.flush(null));
    expect(requests.every((request) => request.request.method === 'GET')).toBe(true);
    return requests.map((request) => request.request.urlWithParams).sort();
  }

  it('fetches what the main pages show, so they work offline without having been opened', () => {
    warmup.run();

    expect(fetched()).toEqual(
      [
        '/api/overview?month=2026-11&view=mine',
        '/api/overview?month=2026-11&view=full',
        '/api/overview?month=2026-10&view=mine',
        '/api/overview?month=2026-10&view=full',
        '/api/transactions',
        '/api/transactions/review',
        '/api/transactions/review/count',
        '/api/settlement',
        '/api/household-ratio',
        '/api/subcategory-shares',
        '/api/mortgage',
        '/api/mortgage/figures',
        '/api/savings',
        '/api/manual-savings-accounts',
        '/api/banks',
        '/api/accounts',
        '/api/categories',
      ].sort(),
    );
  });

  it('only fetches what the service worker saves, or the warm-up would achieve nothing', () => {
    warmup.run();
    const groups = (configJson as { dataGroups: { urls: string[] }[] }).dataGroups;

    // The worker does not anchor the patterns of a data group.
    const unsaved = fetched().filter(
      (url) => !groups.some((group) => group.urls.some((glob) => matches(glob, url, false))),
    );

    expect(unsaved).toEqual([]);
  });

  describe('when the app starts', () => {
    let router: Router;

    beforeEach(() => {
      router = TestBed.inject(Router);
      warmup.watch();
    });

    it('does nothing on the login page, where nobody is signed in', async () => {
      await router.navigateByUrl('/logga-in');

      expect(fetched()).toEqual([]);
    });

    it('runs once the owner is in the app, and only once however much they navigate', async () => {
      await router.navigateByUrl('/banker');
      expect(fetched()).toHaveLength(17);

      await router.navigateByUrl('/delat');
      await router.navigateByUrl('/');

      expect(fetched()).toEqual([]);
    });

    it('runs again after the owner has been signed out and in', async () => {
      await router.navigateByUrl('/banker');
      fetched();
      await router.navigateByUrl('/logga-in');
      await router.navigateByUrl('/banker');

      expect(fetched()).toHaveLength(17);
    });
  });
});
