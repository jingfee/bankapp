import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Confirm } from './confirm';

@Component({
  imports: [Confirm],
  template: `<app-confirm
    heading="Ta bort lånet?"
    message="Det går inte att ångra."
    confirmLabel="Ta bort"
    [danger]="danger()"
    [busy]="busy()"
    [confirmDisabled]="disabled()"
    (confirmed)="confirmed = confirmed + 1"
    (cancelled)="cancelled = cancelled + 1"
  >
    <input data-name aria-label="Namn" />
  </app-confirm>`,
})
class Host {
  readonly danger = signal(true);
  readonly busy = signal(false);
  readonly disabled = signal(false);
  confirmed = 0;
  cancelled = 0;
}

describe('Confirm', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  }
  const confirmButton = () => document.querySelector('[data-confirm]') as HTMLButtonElement;

  afterEach(() => document.body.replaceChildren());

  it('shows the title, the message, extra content and a danger button', () => {
    render();
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.querySelector('[data-title]')?.textContent?.trim()).toBe('Ta bort lånet?');
    expect(dialog.querySelector('[data-confirm-message]')?.textContent).toBe(
      'Det går inte att ångra.',
    );
    expect(dialog.querySelector('[data-name]')).not.toBeNull();
    expect(confirmButton().textContent?.trim()).toBe('Ta bort');
    expect(confirmButton().classList.contains('btn-danger')).toBe(true);
  });

  it('uses the primary style when it is not a danger', () => {
    const fixture = render();
    fixture.componentInstance.danger.set(false);
    fixture.detectChanges();
    expect(confirmButton().classList.contains('btn-primary')).toBe(true);
  });

  it('confirms with the button', () => {
    const fixture = render();
    confirmButton().click();
    expect(fixture.componentInstance.confirmed).toBe(1);
  });

  it('cancels with Avbryt, Escape and the backdrop', () => {
    const fixture = render();
    (document.querySelector('[data-cancel]') as HTMLElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    (document.querySelector('[data-backdrop]') as HTMLElement).click();
    expect(fixture.componentInstance.cancelled).toBe(3);
    expect(fixture.componentInstance.confirmed).toBe(0);
  });

  it('cannot be confirmed while the extra content is incomplete, and Enter respects that', () => {
    const fixture = render();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    expect(confirmButton().disabled).toBe(true);
    (document.querySelector('[data-confirm-form], [data-form]') as HTMLFormElement).requestSubmit();
    expect(fixture.componentInstance.confirmed).toBe(0);
  });

  it('cannot be confirmed or dismissed while busy', () => {
    const fixture = render();
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();
    expect(confirmButton().disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.cancelled).toBe(0);
  });
});
