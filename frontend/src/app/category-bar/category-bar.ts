import { Component, computed, input, output } from '@angular/core';
import { CATEGORY_PALETTE, type CategoryColour, type CategoryIcon } from '@bankapp/shared';
import { CategoryIconComponent } from '../category-icon/category-icon';
import { MoneyPipe } from '../formatting/money.pipe';

/** An expandable row: icon, name, amount over share of the section, and a coloured bar. */
@Component({
  selector: 'app-category-bar',
  imports: [MoneyPipe, CategoryIconComponent],
  template: `
    <button
      type="button"
      class="w-full rounded-lg px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
      [attr.aria-expanded]="expanded()"
      (click)="toggled.emit()"
    >
      <span class="flex items-center gap-3">
        <app-category-icon [icon]="icon()" [colour]="colour()" />
        <span data-name class="min-w-0 flex-1 wrap-break-word">{{ name() }}</span>
        <span class="flex shrink-0 flex-col items-end">
          <span data-amount class="font-medium tabular-nums">{{ total() | money }}</span>
          <span data-share class="text-sm text-zinc-500 tabular-nums dark:text-zinc-400"
            >{{ share() }} %</span
          >
        </span>
      </span>
      <span class="mt-1 block h-2 rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
        <span
          data-bar
          class="block h-2 rounded-full bg-(--category-light) dark:bg-(--category-dark)"
          [style.width.%]="width()"
          [style.--category-light]="palette().light"
          [style.--category-dark]="palette().dark"
        ></span>
      </span>
    </button>
  `,
})
export class CategoryBar {
  readonly icon = input.required<CategoryIcon>();
  readonly colour = input.required<CategoryColour>();
  readonly name = input.required<string>();
  readonly total = input.required<number>();
  /** Share of the section's total, as a whole percentage. */
  readonly share = input.required<number>();
  /** Width relative to the largest bar of the group, as a whole percentage. */
  readonly width = input.required<number>();
  readonly expanded = input.required<boolean>();
  readonly toggled = output<void>();

  protected readonly palette = computed(() => CATEGORY_PALETTE[this.colour()]);
}
