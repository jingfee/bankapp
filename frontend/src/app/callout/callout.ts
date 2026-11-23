import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon, type IconName } from '../icon/icon';

export type CalloutVariant = 'info' | 'warning' | 'danger';

const ICON_FOR: Record<CalloutVariant, IconName> = {
  info: 'info',
  warning: 'triangle-alert',
  danger: 'circle-alert',
};

/**
 * A notice: an icon, a body and an optional action. Every notice and load error uses this.
 * Warnings and errors are announced (`role="alert"`), information politely (`role="status"`).
 *
 * Slots: the body is the content; `[callout-action]` is a link or button on the right.
 */
@Component({
  selector: 'app-callout',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'callout',
    '[class.callout-info]': 'variant() === "info"',
    '[class.callout-warning]': 'variant() === "warning"',
    '[class.callout-danger]': 'variant() === "danger"',
    '[attr.role]': 'variant() === "info" ? "status" : "alert"',
  },
  template: `
    <app-icon class="callout-icon" [name]="icon()" />
    <div class="min-w-0 flex-1"><ng-content /></div>
    <ng-content select="[callout-action]" />
  `,
})
export class Callout {
  readonly variant = input<CalloutVariant>('info');

  protected readonly icon = computed(() => ICON_FOR[this.variant()]);
}
