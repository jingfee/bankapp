import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Sheet } from './sheet';

@Component({
  imports: [Sheet],
  template: `<button data-opener>Öppna</button>
    @if (open()) {
      <app-sheet
        heading="Ny sak"
        [dismissible]="dismissible()"
        (closed)="closed = closed + 1; open.set(false)"
        (submitted)="submitted = submitted + 1"
      >
        <input data-first aria-label="Fält" />
        <ng-container sheet-footer>
          <button type="button" data-cancel>Avbryt</button>
          <button type="submit" data-save>Spara</button>
        </ng-container>
      </app-sheet>
    }`,
})
class Host {
  readonly open = signal(true);
  readonly dismissible = signal(true);
  closed = 0;
  submitted = 0;
}

describe('Sheet', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    (fixture.nativeElement.querySelector('[data-opener]') as HTMLButtonElement).focus();
    fixture.detectChanges();
    return fixture;
  }
  const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
  const escape = () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  afterEach(() => document.body.replaceChildren());

  it('shows a titled modal dialog with a body and a footer, in the body of the page', () => {
    render();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().getAttribute('aria-label')).toBe('Ny sak');
    expect(dialog().querySelector('[data-title]')?.textContent?.trim()).toBe('Ny sak');
    expect(dialog().querySelector('[data-sheet-body] [data-first]')).not.toBeNull();
    expect(dialog().querySelector('[data-sheet-footer] [data-save]')).not.toBeNull();
    expect(dialog().closest('app-sheet')?.parentElement).toBe(document.body);
  });

  it('closes on Escape, the backdrop and the close button', () => {
    for (const close of [
      () => escape(),
      () => (document.querySelector('[data-backdrop]') as HTMLElement).click(),
      () => (document.querySelector('[data-close]') as HTMLElement).click(),
    ]) {
      const fixture = render();
      close();
      fixture.detectChanges();
      expect(fixture.componentInstance.closed).toBe(1);
      expect(dialog()).toBeNull();
      fixture.destroy();
    }
  });

  it('does not close while it is not dismissible', () => {
    const fixture = render();
    fixture.componentInstance.dismissible.set(false);
    fixture.detectChanges();
    escape();
    (document.querySelector('[data-backdrop]') as HTMLElement).click();
    expect(fixture.componentInstance.closed).toBe(0);
  });

  it('emits submitted when its form is submitted', () => {
    const fixture = render();
    (document.querySelector('[data-save]') as HTMLButtonElement).click();
    expect(fixture.componentInstance.submitted).toBe(1);
  });

  it('moves focus in, keeps Tab inside and returns focus to the opener', () => {
    const fixture = render();
    expect(document.activeElement).toBe(dialog());
    const last = document.querySelector('[data-save]') as HTMLElement;
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[data-close]'));

    const opener = fixture.nativeElement.querySelector('[data-opener]') as HTMLElement;
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(opener);
  });

  it('locks page scroll while open', () => {
    const fixture = render();
    expect(document.body.style.overflow).toBe('hidden');
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
