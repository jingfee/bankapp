import { Component, computed, input, output, signal } from '@angular/core';
import type { Category } from '@bankapp/shared';
import { CategoryIconComponent } from '../category-icon/category-icon';
import { Empty } from '../empty/empty';
import { APP_LOCALE } from '../formatting/locale';
import { Icon } from '../icon/icon';
import { OfflineDisabled } from '../offline/offline-disabled';

const fold = (text: string) => text.toLocaleLowerCase(APP_LOCALE);

/**
 * Lets the owner choose a subcategory in two steps: a grid of category tiles, then the chosen
 * category's subcategories as chips. Opens on `current`'s category when there is one. With
 * `searchable`, a search field on top replaces the grid with matching subcategory chips: a query
 * matching a category name shows all of that category's subcategories.
 */
@Component({
  selector: 'app-category-tiles',
  imports: [CategoryIconComponent, Empty, Icon, OfflineDisabled],
  template: `
    <div data-picker class="expand-in flex flex-col gap-4">
      @if (searchable()) {
        <label class="field">
          <app-icon class="field-icon" name="search" [size]="18" />
          <input
            data-category-search
            type="search"
            placeholder="Sök kategori"
            aria-label="Sök kategori"
            class="field-control"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
          @if (query() !== '') {
            <button
              type="button"
              data-clear-category-search
              aria-label="Rensa sökning"
              class="field-icon"
              (click)="query.set('')"
            >
              <app-icon name="x" />
            </button>
          }
        </label>
      }
      @if (searching()) {
        <div data-picker-results class="flex flex-wrap gap-2">
          @for (match of matches(); track match.subcategory.id) {
            <button
              type="button"
              appOfflineDisabled
              class="chip"
              [attr.data-subcategory]="match.subcategory.id"
              [attr.aria-pressed]="current() === match.subcategory.id"
              (click)="picked.emit(match.subcategory.id)"
            >
              <app-category-icon
                [icon]="match.subcategory.icon"
                [colour]="match.category.colour"
                [size]="18"
              />
              {{ match.subcategory.name }}
            </button>
          } @empty {
            <app-empty data-picker-empty icon="search" text="Inga träffar" />
          }
        </div>
      } @else {
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
                appOfflineDisabled
                class="chip"
                [attr.data-subcategory]="subcategory.id"
                [attr.aria-pressed]="current() === subcategory.id"
                (click)="picked.emit(subcategory.id)"
              >
                {{ subcategory.name }}
              </button>
            }
          </div>
        }
      }
    </div>
  `,
})
export class CategoryTiles {
  readonly categories = input.required<Category[]>();
  /** The subcategory the transaction has now, if any. */
  readonly current = input<number | null>(null);
  /** Shows a search field above the grid. */
  readonly searchable = input(false);
  /** The id of the subcategory the owner chose. */
  readonly picked = output<number>();

  protected readonly query = signal('');
  protected readonly searching = computed(() => this.searchable() && this.query().trim() !== '');

  protected readonly matches = computed(() => {
    const query = fold(this.query().trim());
    return this.categories().flatMap((category) =>
      (fold(category.name).includes(query)
        ? category.subcategories
        : category.subcategories.filter((s) => fold(s.name).includes(query))
      ).map((subcategory) => ({ category, subcategory })),
    );
  });

  protected readonly chosen = signal<number | null>(null);

  protected readonly selected = computed(() => {
    const categories = this.categories();
    const id = this.chosen();
    if (id !== null) return categories.find((c) => c.id === id) ?? null;
    const current = this.current();
    return categories.find((c) => c.subcategories.some((s) => s.id === current)) ?? null;
  });
}
