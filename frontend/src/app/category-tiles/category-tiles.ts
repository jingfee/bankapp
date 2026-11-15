import { Component, computed, input, output, signal } from '@angular/core';
import type { Category } from '@bankapp/shared';
import { CategoryIconComponent } from '../category-icon/category-icon';

/**
 * Lets the owner choose a subcategory in two steps: a grid of category tiles, then the chosen
 * category's subcategories as chips. Opens on `current`'s category when there is one.
 */
@Component({
  selector: 'app-category-tiles',
  imports: [CategoryIconComponent],
  template: `
    <div data-picker class="expand-in flex flex-col gap-4">
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
        @for (category of categories(); track category.id) {
          <button
            type="button"
            data-picker-category
            class="tx-row flex flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center text-sm font-medium"
            [class.border-line]="selected()?.id !== category.id"
            [class.border-accent]="selected()?.id === category.id"
            [attr.aria-pressed]="selected()?.id === category.id"
            [attr.data-category-tile]="category.id"
            (click)="chosen.set(category.id)"
          >
            <app-category-icon [icon]="category.icon" [colour]="category.colour" [size]="36" />
            <span data-picker-category-name class="min-w-0 [overflow-wrap:anywhere]">{{
              category.name
            }}</span>
          </button>
        }
      </div>
      @if (selected(); as category) {
        <div data-picker-subcategories class="expand-in flex flex-wrap gap-2">
          @for (subcategory of category.subcategories; track subcategory.id) {
            <button
              type="button"
              class="chip"
              [attr.data-subcategory]="subcategory.id"
              (click)="picked.emit(subcategory.id)"
            >
              {{ subcategory.name }}
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class CategoryTiles {
  readonly categories = input.required<Category[]>();
  /** The subcategory the transaction has now, if any. */
  readonly current = input<number | null>(null);
  /** The id of the subcategory the owner chose. */
  readonly picked = output<number>();

  protected readonly chosen = signal<number | null>(null);

  protected readonly selected = computed(() => {
    const categories = this.categories();
    const id = this.chosen();
    if (id !== null) return categories.find((c) => c.id === id) ?? null;
    const current = this.current();
    return categories.find((c) => c.subcategories.some((s) => s.id === current)) ?? null;
  });
}
