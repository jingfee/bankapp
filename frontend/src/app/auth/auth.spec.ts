import { HttpClient } from '@angular/common/http';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { Offline } from '../offline/offline.service';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authentication', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter(routes),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const unauthorised = { status: 401, statusText: 'Unauthorized' };

  describe('route guard', () => {
    it('sends a signed-out visitor to the login page, remembering where they were going', async () => {
      const navigation = RouterTestingHarness.create('/banker');
      await vi.waitFor(() => http.expectOne('/api/auth/me').flush(null, unauthorised));
      await navigation;

      expect(TestBed.inject(Router).url).toBe('/logga-in?tillbaka=%2Fbanker');
    });

    it('lets a signed-in owner through, and asks the server only once', async () => {
      const harness = await RouterTestingHarness.create();
      const first = harness.navigateByUrl('/banker');
      await vi.waitFor(() => http.expectOne('/api/auth/me').flush({ username: 'owner' }));
      await first;
      http.match(() => true);

      await harness.navigateByUrl('/delat');
      http.match((r) => r.url !== '/api/auth/me');

      expect(TestBed.inject(Router).url).toBe('/delat');
    });

    it('does not guard the login page', async () => {
      await RouterTestingHarness.create('/logga-in');

      expect(TestBed.inject(Router).url).toBe('/logga-in');
    });
  });

  describe('interceptor', () => {
    it('sends the owner to the login page on a 401, and back afterwards', async () => {
      const router = TestBed.inject(Router);
      TestBed.inject(AuthService).login({ username: 'owner', password: 'x' }).subscribe();
      http.expectOne('/api/auth/login').flush(null, { status: 204, statusText: 'No Content' });
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/transaktioner');
      http.match(() => true);

      TestBed.inject(HttpClient)
        .get('/api/banks')
        .subscribe({ error: () => undefined });
      http.expectOne('/api/banks').flush(null, unauthorised);
      await harness.fixture.whenStable();

      expect(router.url).toBe('/logga-in?tillbaka=%2Ftransaktioner');
    });

    it('leaves a wrong password on the login page to the page itself', async () => {
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/logga-in');

      TestBed.inject(HttpClient)
        .post('/api/auth/login', {})
        .subscribe({ error: () => undefined });
      http.expectOne('/api/auth/login').flush(null, unauthorised);

      expect(router.url).toBe('/logga-in');
    });
  });

  describe('service', () => {
    it('does not treat a network failure as being signed out, and asks again next time', () => {
      const auth = TestBed.inject(AuthService);
      const answers: boolean[] = [];

      auth.check().subscribe((ok) => answers.push(ok));
      http.expectOne('/api/auth/me').error(new ProgressEvent('error'));
      auth.check().subscribe((ok) => answers.push(ok));
      http.expectOne('/api/auth/me').flush(null, unauthorised);

      expect(answers).toEqual([true, false]);
    });

    it('is not logged out when the logout request fails', () => {
      const auth = TestBed.inject(AuthService);
      auth.check().subscribe();
      http.expectOne('/api/auth/me').flush({ username: 'owner' });
      let failed = false;

      auth.logout().subscribe({ error: () => (failed = true) });
      http.expectOne('/api/auth/logout').flush(null, { status: 500, statusText: 'Server Error' });
      auth.check().subscribe();

      expect(failed).toBe(true);
      http.expectNone('/api/auth/me'); // still known to be signed in
    });

    it('logs out on the server and asks again afterwards', () => {
      const auth = TestBed.inject(AuthService);
      auth.check().subscribe();
      http.expectOne('/api/auth/me').flush({ username: 'owner' });

      auth.logout().subscribe();
      http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
      auth.check().subscribe();

      http.expectOne('/api/auth/me').flush(null, unauthorised);
    });

    describe('logging out while offline', () => {
      const noContent = { status: 204, statusText: 'No Content' };
      let names: string[];

      beforeEach(() => {
        localStorage.clear();
        names = ['ngsw:/:db:control', 'ngsw:/:1a2b3c:data:pages:cache'];
        vi.stubGlobal('caches', {
          keys: () => Promise.resolve([...names]),
          delete: (name: string) => {
            names = names.filter((existing) => existing !== name);
            return Promise.resolve(true);
          },
        });
      });

      afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
      });

      /** The app is offline and the owner presses Logga ut. */
      function logOutOffline() {
        const auth = TestBed.inject(AuthService);
        TestBed.inject(Offline).markOffline();
        let done = false;
        auth.logout().subscribe(() => (done = true));
        return { auth, done: () => done };
      }

      it('deletes saved data at once, without asking the server, and counts as signed out', async () => {
        const { auth, done } = logOutOffline();

        http.expectNone('/api/auth/logout');
        expect(done()).toBe(true);
        await vi.waitFor(() => expect(names).toEqual(['ngsw:/:db:control']));
        const answers: boolean[] = [];
        auth.check().subscribe((ok) => answers.push(ok));
        http.expectNone('/api/auth/me');
        expect(answers).toEqual([false]);
      });

      it('deletes saved data and signs out too when the logout request finds no server', async () => {
        const auth = TestBed.inject(AuthService);
        let done = false;

        auth.logout().subscribe(() => (done = true));
        http.expectOne('/api/auth/logout').error(new ProgressEvent('error'));

        expect(done).toBe(true);
        await vi.waitFor(() => expect(names).toEqual(['ngsw:/:db:control']));
      });

      it('sends the pending logout once when the server is reached again', async () => {
        logOutOffline();
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 200 })));

        await TestBed.inject(Offline).check();
        http.expectOne('/api/auth/logout').flush(null, noContent);
        await TestBed.inject(Offline).check();

        http.expectNone('/api/auth/logout');
      });

      it('keeps the reminder, across a restart, until the server has answered', async () => {
        logOutOffline();
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 200 })));
        await TestBed.inject(Offline).check();
        http.expectOne('/api/auth/logout').error(new ProgressEvent('error'));

        expect(localStorage.length).toBeGreaterThan(0);
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
        });
        http = TestBed.inject(HttpTestingController);
        TestBed.inject(Offline).markOffline();
        await TestBed.inject(Offline).check();

        http.expectOne('/api/auth/logout').flush(null, noContent);
      });

      it('does not end the new session when the owner logs in before the server was reached', async () => {
        const { auth } = logOutOffline();

        auth.login({ username: 'owner', password: 'x' }).subscribe();
        http.expectOne('/api/auth/login').flush(null, noContent);
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 200 })));
        await TestBed.inject(Offline).check();

        http.expectNone('/api/auth/logout');
        const answers: boolean[] = [];
        auth.check().subscribe((ok) => answers.push(ok));
        expect(answers).toEqual([true]);
      });

      it('keeps the reminder when the login itself fails', async () => {
        const { auth } = logOutOffline();

        auth.login({ username: 'owner', password: 'wrong' }).subscribe({ error: () => undefined });
        http.expectOne('/api/auth/login').flush(null, unauthorised);
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 200 })));
        await TestBed.inject(Offline).check();

        http.expectOne('/api/auth/logout').flush(null, noContent);
      });
    });

    describe('saved data', () => {
      // What the service worker keeps: one cache and some bookkeeping per data group, next to
      // the app shell and its own control data, which must stay.
      const kept = ['ngsw:/:db:control', 'ngsw:/:1a2b3c:assets:app:cache'];
      const saved = [
        'ngsw:/:1a2b3c:data:pages:cache',
        'ngsw:/:1a2b3c:data:opened:cache',
        'ngsw:/:db:1a2b3c:data:opened:lru',
      ];
      let names: string[];

      beforeEach(() => {
        names = [...kept, ...saved];
        vi.stubGlobal('caches', {
          keys: () => Promise.resolve([...names]),
          delete: (name: string) => {
            names = names.filter((existing) => existing !== name);
            return Promise.resolve(true);
          },
        });
      });

      afterEach(() => vi.unstubAllGlobals());

      it('is deleted when the owner logs out, and nothing else is', async () => {
        const auth = TestBed.inject(AuthService);

        auth.logout().subscribe();
        http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });

        await vi.waitFor(() => expect(names).toEqual(kept));
      });

      it('is deleted when the server ends the session', async () => {
        TestBed.inject(AuthService).markSignedOut();

        await vi.waitFor(() => expect(names).toEqual(kept));
      });
    });
  });
});
