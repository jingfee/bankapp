import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { LoggaInPage } from './logga-in.page';

describe('LoggaInPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'logga-in', component: LoggaInPage },
          { path: '**', children: [] },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function open(url = '/logga-in') {
    const harness = await RouterTestingHarness.create(url);
    const html = harness.routeNativeElement as HTMLElement;
    const input = (name: string) => html.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    const type = (name: string, value: string) => {
      input(name).value = value;
      input(name).dispatchEvent(new Event('input'));
    };
    const submit = async () => {
      (html.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      await harness.fixture.whenStable();
    };
    return { harness, html, input, type, submit };
  }

  const wrongCredentials = { status: 401, statusText: 'Unauthorized' };

  it('has no "remember me" option: sessions are always long-lived', async () => {
    const { html } = await open();

    expect(html.querySelector('input[type="checkbox"]')).toBeNull();
    expect(html.textContent).not.toContain('Kom ihåg');
  });

  it('logs in and goes to the overview', async () => {
    const { harness, type, submit } = await open();

    type('username', 'owner');
    type('password', 'secret');
    await submit();
    const request = http.expectOne('/api/auth/login');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();

    expect(request.request.body).toEqual({ username: 'owner', password: 'secret' });
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it.each([
    ['/logga-in?tillbaka=%2Ftransaktioner', '/transaktioner'],
    ['/logga-in?tillbaka=%2F%2Fevil.example', '/'],
    ['/logga-in?tillbaka=https%3A%2F%2Fevil.example', '/'],
  ])('after %s goes to %s', async (url, destination) => {
    const { harness, type, submit } = await open(url);

    type('password', 'secret');
    await submit();
    http.expectOne('/api/auth/login').flush(null, { status: 204, statusText: 'No Content' });
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe(destination);
  });

  it('asks for a password without calling the server when it is empty', async () => {
    const { html, type, submit } = await open();

    type('username', 'owner');
    await submit();

    expect(html.querySelector('[role="alert"]')?.textContent).toContain('Ange ditt lösenord.');
    http.expectNone('/api/auth/login');
  });

  it('shows the error and shakes the card on wrong credentials', async () => {
    const { harness, html, type, submit } = await open();

    type('username', 'owner');
    type('password', 'nope');
    await submit();
    http.expectOne('/api/auth/login').flush(null, wrongCredentials);
    harness.detectChanges();

    expect(html.querySelector('[role="alert"]')?.textContent).toContain(
      'Fel användarnamn eller lösenord.',
    );
    expect(html.querySelector('form')?.classList).toContain('shake');
  });

  it('says so when there have been too many attempts', async () => {
    const { harness, html, type, submit } = await open();

    type('password', 'nope');
    await submit();
    http.expectOne('/api/auth/login').flush(null, { status: 429, statusText: 'Too Many Requests' });
    harness.detectChanges();

    expect(html.querySelector('[role="alert"]')?.textContent).toContain('För många försök');
  });

  it('shows a spinner and disables the button while waiting', async () => {
    const { html, type, submit } = await open();

    type('password', 'secret');
    await submit();

    expect(html.querySelector('button[type="submit"] .spinner')).not.toBeNull();
    expect((html.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    http.expectOne('/api/auth/login').flush(null, wrongCredentials);
  });

  it('shows and hides the password', async () => {
    const { html, input, harness } = await open();
    expect(input('password').type).toBe('password');

    (html.querySelector('button[aria-label="Visa lösenordet"]') as HTMLButtonElement).click();
    await harness.fixture.whenStable();

    expect(input('password').type).toBe('text');
    expect(html.querySelector('button[aria-label="Dölj lösenordet"]')).not.toBeNull();
  });
});
