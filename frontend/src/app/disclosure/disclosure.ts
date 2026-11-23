import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { Icon } from '../icon/icon';

/**
 * A show/hide section: a row with a label, an optional count and a chevron that rotates. The whole
 * row is the button. The content is only rendered while open.
 */
@Component({
  selector: 'app-disclosure',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button
      type="button"
      data-disclosure-toggle
      class="disclosure-row"
      [attr.aria-expanded]="open()"
      (click)="open.set(!open())"
    >
      <span class="min-w-0 flex-1 text-left" [class.card-title]="title()">{{ label() }}</span>
      @if (count() !== null) {
        <span data-disclosure-count class="text-sm text-muted tabular-nums">{{ count() }}</span>
      }
      <app-icon class="disclosure-chevron" [class.rotate-180]="open()" name="chevron-down" />
    </button>
    @if (open()) {
      <div data-disclosure-body class="mt-3"><ng-content /></div>
    }
  `,
})
export class Disclosure {
  readonly label = input.required<string>();
  readonly count = input<number | null>(null);
  /** Style the label as a card title, for a disclosure that is a card on its own. */
  readonly title = input(false);
  readonly open = model(false);
}
