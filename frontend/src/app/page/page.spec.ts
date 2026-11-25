import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Offline } from '../offline/offline.service';
import { Page } from './page';

@Component({
  imports: [Page],
  template: `
    <app-page width="narrow" title="Rubrik" subtitle="Underrubrik">
      <a page-back href="/x">← Tillbaka</a>
      <button page-actions type="button">Åtgärd</button>
      <p data-body>Innehåll</p>
    </app-page>
  `,
})
class Host {}

@Component({
  imports: [Page],
  template: `
    <app-page>
      <h1 page-title data-custom-title>Egen titel</h1>
      <p page-subtitle data-custom-subtitle>Egen status</p>
    </app-page>
  `,
})
class CustomHost {}

describe('Page', () => {
  it('renders the title, subtitle, back link, actions and body in the shell', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('h1')?.textContent).toBe('Rubrik');
    expect(el.querySelector('[data-page-subtitle]')?.textContent).toBe('Underrubrik');
    const header = el.querySelector('[data-page-header]')!;
    expect(header.querySelector('a[page-back]')).not.toBeNull();
    expect(header.querySelector('button[page-actions]')?.textContent).toBe('Åtgärd');
    expect(el.querySelector('main [data-body]')).not.toBeNull();
  });

  it('is 672 px wide when narrow and 1024 px when wide (the default)', () => {
    const narrow = TestBed.createComponent(Host);
    narrow.detectChanges();
    expect(narrow.nativeElement.querySelector('main').classList).toContain('max-w-2xl');

    const wide = TestBed.createComponent(CustomHost);
    wide.detectChanges();
    expect(wide.nativeElement.querySelector('main').classList).toContain('max-w-5xl');
  });

  it('lets a page supply its own title and subtitle content', () => {
    const fixture = TestBed.createComponent(CustomHost);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-custom-title]')?.textContent).toBe('Egen titel');
    expect(el.querySelector('[data-custom-subtitle]')?.textContent).toBe('Egen status');
    expect(el.querySelector('[data-page-title]')).toBeNull();
  });
});

@Component({
  imports: [Page],
  template: `<app-page title="Rubrik" [fetchedAt]="reads()"><p>Innehåll</p></app-page>`,
})
class SavedHost {
  readonly reads = signal<(Date | undefined)[]>([]);
}

describe('Page saved-data line', () => {
  const isOffline = signal(false);
  const line = (el: HTMLElement) => el.querySelector('[data-saved-data]')?.textContent?.trim();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-25T12:00:00+01:00'));
    isOffline.set(false);
    TestBed.configureTestingModule({
      providers: [{ provide: Offline, useValue: { isOffline: isOffline.asReadonly() } }],
    });
  });
  afterEach(() => vi.useRealTimers());

  it('says nothing while online', () => {
    const fixture = TestBed.createComponent(SavedHost);
    fixture.componentInstance.reads.set([new Date('2026-11-24T14:02:00+01:00')]);
    fixture.detectChanges();
    expect(line(fixture.nativeElement)).toBeUndefined();
  });

  it('says when the saved data was fetched while offline, and goes when back online', () => {
    isOffline.set(true);
    const fixture = TestBed.createComponent(SavedHost);
    fixture.componentInstance.reads.set([new Date('2026-11-24T14:02:00+01:00')]);
    fixture.detectChanges();
    expect(line(fixture.nativeElement)).toBe('Visar sparad data från igår 14:02');

    isOffline.set(false);
    fixture.detectChanges();
    expect(line(fixture.nativeElement)).toBeUndefined();
  });

  it('shows the oldest of several reads', () => {
    isOffline.set(true);
    const fixture = TestBed.createComponent(SavedHost);
    fixture.componentInstance.reads.set([
      new Date('2026-11-25T09:30:00+01:00'),
      new Date('2026-11-10T08:15:00+01:00'),
      undefined,
    ]);
    fixture.detectChanges();
    expect(line(fixture.nativeElement)).toBe('Visar sparad data från 10 nov 08:15');
  });

  it('turns idag into igår when the device stays offline past midnight', () => {
    isOffline.set(true);
    vi.setSystemTime(new Date('2026-11-25T23:50:00+01:00'));
    const fixture = TestBed.createComponent(SavedHost);
    fixture.componentInstance.reads.set([new Date('2026-11-25T14:02:00+01:00')]);
    fixture.detectChanges();
    expect(line(fixture.nativeElement)).toBe('Visar sparad data från idag 14:02');

    vi.advanceTimersByTime(20 * 60 * 1000);
    fixture.detectChanges();
    expect(line(fixture.nativeElement)).toBe('Visar sparad data från igår 14:02');
  });

  it('says nothing when no read has been fetched', () => {
    isOffline.set(true);
    const fixture = TestBed.createComponent(SavedHost);
    fixture.detectChanges();
    expect(line(fixture.nativeElement)).toBeUndefined();
  });
});
