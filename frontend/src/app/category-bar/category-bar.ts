import { Component, computed, input, output } from '@angular/core';
import { CATEGORY_PALETTE, type CategoryColour, type CategoryIcon } from '@bankapp/shared';
import { CategoryIconComponent } from '../category-icon/category-icon';
import { MoneyPipe } from '../formatting/money.pipe';

/**
 * An expandable row: flat icon, name, amount over share, a thin bar in the category's colour that
 * grows in, and a chevron that turns when the row is open.
 */
@Component({
  selector: 'app-category-bar',
  imports: [MoneyPipe, CategoryIconComponent],
  template: `
    <button
      type="button"
      class="tx-row flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left"
      [attr.aria-expanded]="expanded()"
      (click)="toggled.emit()"
    >
      <app-category-icon [icon]="icon()" [colour]="colour()" [size]="36" />
      <span class="flex min-w-0 flex-1 flex-col gap-1.5">
        <span class="flex items-baseline justify-between gap-3">
          <span data-name class="min-w-0 wrap-break-word text-[15px] font-medium">{{
            name()
          }}</span>
          <span class="flex shrink-0 items-baseline gap-2">
            <span data-amount class="amount text-[15px]">{{ total() | money }}</span>
            <span data-share class="w-11 text-right text-xs text-muted tabular-nums"
              >{{ share() }} %</span
            >
          </span>
        </span>
        <span class="block h-1 rounded-full bg-surface-3" aria-hidden="true">
          <span
            data-bar
            class="bar-grow block h-1 rounded-full bg-(--category-colour)"
            [style.width.%]="width()"
            [style.--category-colour]="palette().colour"
          ></span>
        </span>
      </span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4 shrink-0 text-muted transition-transform duration-200"
        [class.rotate-90]="expanded()"
        aria-hidden="true"
      >
        <path d="m9 6 6 6-6 6" />
      </svg>
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
