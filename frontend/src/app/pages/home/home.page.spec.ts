import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { HealthResponse } from '@bankapp/shared';
import { HomePage } from './home.page';

describe('HomePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  /** Renders the page and answers its health check with `respond`. */
  async function render(
    respond: (request: ReturnType<HttpTestingController['expectOne']>) => void,
  ): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(HomePage);
    await fixture.whenStable();
    respond(TestBed.inject(HttpTestingController).expectOne('/api/health'));
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const serverUp = (request: ReturnType<HttpTestingController['expectOne']>) =>
    request.flush({ status: 'ok' } satisfies HealthResponse);
  const serverDown = (request: ReturnType<HttpTestingController['expectOne']>) =>
    request.error(new ProgressEvent('error'));

  it('greets the owner in Swedish', async () => {
    const page = await render(serverUp);

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Bankapp');
    expect(page.textContent).toContain('Inga banker är anslutna ännu.');
  });

  it('shows that the server is reachable', async () => {
    const page = await render(serverUp);

    expect(page.textContent).toContain('Servern svarar');
    expect(page.textContent).not.toContain('Servern svarar inte');
  });

  it('shows that the server is unreachable', async () => {
    const page = await render(serverDown);

    expect(page.textContent).toContain('Servern svarar inte');
  });
});
