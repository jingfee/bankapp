import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConnectionResultPage } from './connection-result.page';

describe('ConnectionResultPage', () => {
  function render(query: Record<string, string>): HTMLElement {
    TestBed.configureTestingModule({
      imports: [ConnectionResultPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(query) } },
        },
      ],
    });
    const fixture = TestBed.createComponent(ConnectionResultPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('confirms a successful connection and links to the overview', () => {
    const page = render({ status: 'ok', bank: 'Swedbank' });

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Banken är ansluten');
    expect(page.textContent).toContain('Swedbank är nu ansluten.');
    expect(page.querySelector('[role=alert]')).toBeNull();
    expect(page.querySelector('a[href="/"]')?.textContent?.trim()).toBe('Till översikten');
  });

  it('reports a cancelled or failed login as an error and offers to try again', () => {
    const page = render({ status: 'fel' });

    expect(page.querySelector('h1')?.textContent?.trim()).toBe('Anslutningen misslyckades');
    expect(page.querySelector('[role=alert]')?.textContent).toContain(
      'BankID-inloggningen avbröts eller misslyckades',
    );
    expect(page.querySelector('a[href="/anslut-bank"]')?.textContent?.trim()).toBe('Försök igen');
  });

  it('explains that a bank which is already connected was left as it was', () => {
    const page = render({ status: 'redan', bank: 'Swedbank' });

    expect(page.textContent).toContain('Swedbank är redan ansluten.');
  });

  it('treats an unknown status as a failure', () => {
    const page = render({ status: 'whatever' });

    expect(page.querySelector('[role=alert]')).not.toBeNull();
  });
});
