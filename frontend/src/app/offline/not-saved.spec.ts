import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ReadFailed } from './not-saved';
import { Offline } from './offline.service';

@Component({
  imports: [ReadFailed],
  template: `<app-read-failed>Sidan kunde inte hämtas.</app-read-failed>`,
})
class Host {}

describe('ReadFailed', () => {
  const render = () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  };

  it('shows the page’s error while online', () => {
    const el = render().nativeElement as HTMLElement;

    expect(el.querySelector('[role=alert]')?.textContent).toContain('Sidan kunde inte hämtas.');
    expect(el.querySelector('[data-not-saved]')).toBeNull();
  });

  it('says Inte sparad, and that it needs the server, while offline', () => {
    TestBed.inject(Offline).markOffline();
    const el = render().nativeElement as HTMLElement;

    expect(el.querySelector('[data-empty-text]')?.textContent).toBe('Inte sparad');
    expect(el.querySelector('[data-empty-hint]')?.textContent).toContain('online');
    expect(el.querySelector('[role=alert]')).toBeNull();
  });

  it('gives the error back when the app is back online', async () => {
    const offline = TestBed.inject(Offline);
    offline.markOffline();
    const fixture = render();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 200 })));
    await offline.check();
    vi.unstubAllGlobals();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-not-saved]')).toBeNull();
  });
});
