import { Component, computed, inject, input, output } from '@angular/core';
import type { ShareOption } from '@bankapp/shared';
import { Offline } from '../offline/offline.service';
import { Names } from '../names';
import { SHARE_OPTION_ORDER, shareLabels } from '../share-display';

/** The one way a share is chosen: the owner, 50/50, Hushåll, the partner as a segmented control. */
@Component({
  selector: 'app-share-control',
  template: `
    <div
      class="segmented"
      [class.w-full]="fullWidth()"
      [class.grid]="fullWidth()"
      [class.grid-cols-4]="fullWidth()"
      role="group"
      [attr.aria-label]="label()"
    >
      @for (choice of choices(); track choice.option) {
        <button
          type="button"
          [attr.data-share]="choice.option"
          [attr.aria-pressed]="value() === choice.option"
          [attr.title]="choice.disabled ? householdTitle() : null"
          [disabled]="disabled() || choice.disabled || offline.isOffline()"
          class="px-1 disabled:opacity-40"
          (click)="choose(choice.option)"
        >
          {{ choice.label }}
        </button>
      }
    </div>
    @if (householdDisabled()) {
      <p data-household-note class="mt-2 text-sm text-muted">{{ householdTitle() }}</p>
    }
  `,
  styles: ':host { display: block; } :host(:not([fullwidth])) .segmented { display: inline-flex; }',
  host: { '[attr.fullwidth]': 'fullWidth() ? "" : null' },
})
export class ShareControl {
  /** Choosing a share changes something, so every choice is disabled while offline. */
  protected readonly offline = inject(Offline);
  private readonly names = inject(Names).names;
  /** The share option currently chosen. */
  readonly value = input<ShareOption | null>(null);
  readonly label = input('Välj andel');
  readonly fullWidth = input(false);
  readonly disabled = input(false);
  /** Hushåll cannot be chosen until a household ratio is set. */
  readonly householdDisabled = input(false);
  /** Hushåll with its ratio, shown as a tooltip where known. */
  readonly householdTitle = input('Hushåll kan väljas först när en hushållsandel har ställts in.');
  readonly changed = output<ShareOption>();

  protected readonly choices = computed(() => {
    const labels = shareLabels(this.names());
    return SHARE_OPTION_ORDER.map((option) => ({
      option,
      label: labels[option],
      disabled: option === 'household' && this.householdDisabled(),
    }));
  });

  protected choose(option: ShareOption): void {
    this.changed.emit(option);
  }
}
