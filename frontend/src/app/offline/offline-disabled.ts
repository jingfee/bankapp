import { Directive, ElementRef, computed, effect, inject, input } from '@angular/core';
import { Offline } from './offline.service';

const FORM_CONTROLS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

/**
 * Disables a control that changes something while the app is offline (ADR 0017): the control
 * stays where it is, so pages keep their shape, and is enabled again as soon as the app is back.
 *
 * Put it on every button or link that makes a change or opens a form to make one. Where the
 * control is already disabled for another reason, pass that as the value
 * (`[appOfflineDisabled]="saving()"`) instead of a `[disabled]` binding, which would fight with
 * this one: the control is disabled when either holds. Written bare it is disabled only offline.
 *
 * A link is not a form control, so it cannot be disabled. It is marked `aria-disabled`, taken out
 * of the tab order, and its click is stopped before it is followed.
 */
@Directive({
  selector: '[appOfflineDisabled]',
  host: {
    '[attr.disabled]': 'blocked() && isControl ? "" : null',
    '[attr.aria-disabled]': 'blocked() && !isControl ? "true" : null',
  },
})
export class OfflineDisabled {
  /** Whether the control is disabled for a reason of its own (any truthy value); bare, it is not. */
  readonly appOfflineDisabled = input(false, {
    transform: (value: unknown) => value !== '' && Boolean(value),
  });

  private readonly offline = inject(Offline);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly isControl = FORM_CONTROLS.has(this.element.tagName);
  protected readonly blocked = computed(
    () => this.offline.isOffline() || this.appOfflineDisabled(),
  );

  constructor() {
    if (!this.isControl) {
      // Taken out of the tab order while blocked, and put back as it was (a menu item has its own).
      const tabindex = this.element.getAttribute('tabindex');
      effect(() => {
        if (this.blocked()) this.element.setAttribute('tabindex', '-1');
        else if (tabindex === null) this.element.removeAttribute('tabindex');
        else this.element.setAttribute('tabindex', tabindex);
      });
    }
    // In the capture phase, registered before the template's own listeners, so a click on a
    // blocked link never reaches them nor follows the link.
    this.element.addEventListener(
      'click',
      (event) => {
        if (this.isControl || !this.blocked()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true },
    );
  }
}
