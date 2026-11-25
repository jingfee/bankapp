import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon, type IconName } from '../icon/icon';

/**
 * An empty list: an icon, one sentence, an optional shorter line under it and, where there is
 * one, the next action.
 *
 * Slot: `[empty-action]` is the action (a button or link).
 */
@Component({
  selector: 'app-empty',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'empty' },
  template: `
    <span class="empty-icon"><app-icon [name]="icon()" [size]="22" /></span>
    <p data-empty-text class="text-muted">{{ text() }}</p>
    @if (hint(); as line) {
      <p data-empty-hint class="text-sm text-muted">{{ line }}</p>
    }
    <ng-content select="[empty-action]" />
  `,
})
export class Empty {
  readonly icon = input<IconName>('inbox');
  readonly text = input.required<string>();
  readonly hint = input<string>();
}
