import { Component, input } from '@angular/core';
import type { TransactionCategory } from '@bankapp/shared';
import { CategoryIconComponent } from './category-icon';

/**
 * What a transaction is categorised as, at a glance: its subcategory's icon, with a "?" badge
 * while it is only a guess, or striped placeholder when it is uncategorised. A pending
 * transaction gets a dashed outline either way.
 */
@Component({
  selector: 'app-transaction-category-badge',
  imports: [CategoryIconComponent],
  host: { class: 'inline-flex' },
  template: `
    @if (category(); as c) {
      <app-category-icon
        [attr.data-guessed]="c.confirmed ? null : ''"
        [attr.data-pending]="pending() ? '' : null"
        [icon]="c.subcategory.icon"
        [colour]="c.category.colour"
        [guessed]="!c.confirmed"
        [pending]="pending()"
        [size]="size()"
        [label]="c.confirmed ? c.subcategory.name : c.subcategory.name + ' (gissad)'"
      />
    } @else {
      <span
        data-uncategorised
        role="img"
        aria-label="Okategoriserad"
        class="category-icon category-icon-uncategorised"
        [class.category-icon-pending]="pending()"
        [attr.data-pending]="pending() ? '' : null"
        [style.--size.px]="size()"
      ></span>
    }
  `,
})
export class TransactionCategoryBadge {
  readonly category = input.required<TransactionCategory | null>();
  readonly pending = input(false);
  readonly size = input<18 | 28 | 36 | 40 | 60>(40);
}
