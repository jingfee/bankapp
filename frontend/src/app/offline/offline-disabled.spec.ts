import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OfflineDisabled } from './offline-disabled';
import { Offline } from './offline.service';

@Component({
  imports: [OfflineDisabled],
  template: `
    <button data-plain type="button" appOfflineDisabled (click)="clicks.update((n) => n + 1)">
      Spara
    </button>
    <button
      data-busy
      type="button"
      [appOfflineDisabled]="busy()"
      (click)="clicks.update((n) => n + 1)"
    >
      Spara
    </button>
    <a data-link href="/x" appOfflineDisabled (click)="clicks.update((n) => n + 1)">Anslut</a>
    <a data-item href="/y" tabindex="-1" appOfflineDisabled>Redigera</a>
  `,
})
class Host {
  readonly busy = signal(false);
  readonly clicks = signal(0);
}

describe('OfflineDisabled', () => {
  const isOffline = signal(false);

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return {
      fixture,
      host: fixture.componentInstance,
      plain: el.querySelector<HTMLButtonElement>('[data-plain]')!,
      busy: el.querySelector<HTMLButtonElement>('[data-busy]')!,
      link: el.querySelector<HTMLAnchorElement>('[data-link]')!,
    };
  }

  beforeEach(() => {
    isOffline.set(false);
    TestBed.configureTestingModule({
      providers: [{ provide: Offline, useValue: { isOffline: isOffline.asReadonly() } }],
    });
  });

  it('leaves a control enabled while online', () => {
    const { plain, busy, link } = render();

    expect(plain.disabled).toBe(false);
    expect(busy.disabled).toBe(false);
    expect(link.getAttribute('aria-disabled')).toBeNull();
  });

  it('disables a control while offline and enables it again when back online, with no reload', async () => {
    const { fixture, plain } = render();

    isOffline.set(true);
    await fixture.whenStable();
    expect(plain.disabled).toBe(true);

    isOffline.set(false);
    await fixture.whenStable();
    expect(plain.disabled).toBe(false);
  });

  it('keeps a control disabled for its own reason while online, and for being offline', async () => {
    const { fixture, host, busy } = render();

    host.busy.set(true);
    await fixture.whenStable();
    expect(busy.disabled).toBe(true);

    host.busy.set(false);
    isOffline.set(true);
    await fixture.whenStable();
    expect(busy.disabled).toBe(true);

    isOffline.set(false);
    await fixture.whenStable();
    expect(busy.disabled).toBe(false);
  });

  it('does not let a link that is not a button be followed or clicked while offline', async () => {
    const { fixture, host, link } = render();
    isOffline.set(true);
    await fixture.whenStable();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(link.getAttribute('tabindex')).toBe('-1');
    expect(click.defaultPrevented).toBe(true);
    expect(host.clicks()).toBe(0);
  });

  it('puts back the tabindex a link had of its own once back online', async () => {
    const { fixture } = render();
    const item = (fixture.nativeElement as HTMLElement).querySelector('[data-item]')!;

    isOffline.set(true);
    await fixture.whenStable();
    expect(item.getAttribute('tabindex')).toBe('-1');
    expect(item.getAttribute('aria-disabled')).toBe('true');

    isOffline.set(false);
    await fixture.whenStable();
    expect(item.getAttribute('tabindex')).toBe('-1');
    expect(item.getAttribute('aria-disabled')).toBeNull();
    const link = (fixture.nativeElement as HTMLElement).querySelector('[data-link]')!;
    expect(link.getAttribute('tabindex')).toBeNull();
  });
});
