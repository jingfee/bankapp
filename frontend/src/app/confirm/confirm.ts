import { Component, input, output } from '@angular/core';
import { OfflineDisabled } from '../offline/offline-disabled';
import { Sheet } from '../sheet/sheet';

/**
 * Replaces the browser’s confirmation dialog: a title, one or two sentences, optional extra content
 * (checkboxes, a type-to-confirm field) and Avbryt next to a danger or primary button.
 *
 * Slots: the content is the extra content below the message. Put `data-autofocus` on a field
 * that should take focus; otherwise the dialog does. Enter in a field confirms, unless
 * `confirmDisabled` is set.
 */
@Component({
  selector: 'app-confirm',
  imports: [Sheet, OfflineDisabled],
  template: `
    <app-sheet
      size="small"
      [dialogRole]="'alertdialog'"
      [heading]="heading()"
      [dismissible]="!busy()"
      (closed)="cancelled.emit()"
      (submitted)="proceed()"
    >
      @if (message()) {
        <p data-confirm-message>{{ message() }}</p>
      }
      <ng-content />
      <ng-container sheet-footer>
        <button
          type="button"
          data-cancel
          class="btn btn-ghost"
          [disabled]="busy()"
          (click)="cancelled.emit()"
        >
          Avbryt
        </button>
        <button
          type="submit"
          data-confirm
          class="btn flex-1"
          [class.btn-danger]="danger()"
          [class.btn-primary]="!danger()"
          [appOfflineDisabled]="busy() || confirmDisabled()"
        >
          {{ confirmLabel() }}
        </button>
      </ng-container>
    </app-sheet>
  `,
})
export class Confirm {
  readonly heading = input.required<string>();
  /** One or two sentences saying what happens. */
  readonly message = input('');
  readonly confirmLabel = input('Bekräfta');
  /** The confirming button is red: something is deleted or ended. */
  readonly danger = input(true);
  /** The request is running; nothing can be dismissed or confirmed again. */
  readonly busy = input(false);
  /** Extra content is not filled in yet (e.g. the name was not typed). */
  readonly confirmDisabled = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected proceed(): void {
    if (!this.busy() && !this.confirmDisabled()) this.confirmed.emit();
  }
}
