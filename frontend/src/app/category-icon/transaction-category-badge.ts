import { Component, input } from '@angular/core';
import type { TransactionCategory } from '@bankapp/shared';
import { CategoryIconComponent } from './category-icon';

/**
 * What a transaction is categorised as, at a glance: its subcategory's icon on its category's
 * colour, or a neutral placeholder when it is uncategorised.
 */
@Component({
  selector: 'app-transaction-category-badge',
  imports: [CategoryIconComponent],
  host: { class: 'inline-flex' },
  template: `
    @if (category(); as c) {
      <app-category-icon
        [icon]="c.subcategory.icon"
        [colour]="c.category.colour"
        [label]="c.subcategory.name"
      />
    } @else {
      <span
        data-uncategorised
        role="img"
        aria-label="Okategoriserad"
        class="inline-flex size-8 shrink-0 rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-600"
      ></span>
    }
  `,
})
export class TransactionCategoryBadge {
  readonly category = input.required<TransactionCategory | null>();
}
