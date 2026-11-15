import { HttpClient } from '@angular/common/http';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
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

      await harness.navigateByUrl('/andelar');
      http.match((r) => r.url !== '/api/auth/me');

      expect(TestBed.inject(Router).url).toBe('/andelar');
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
      http.expectOne('/api/auth/logout').error(new ProgressEvent('error'));
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
  });
});
