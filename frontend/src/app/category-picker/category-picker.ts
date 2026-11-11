import { Component, computed, input, output, signal } from '@angular/core';
import type { Category } from '@bankapp/shared';
import { CategoryIconComponent } from '../category-icon/category-icon';
import { APP_LOCALE } from '../formatting/locale';

const fold = (text: string) => text.toLocaleLowerCase(APP_LOCALE);

/**
 * Lets the owner choose a subcategory: every subcategory grouped under its category, in the
 * owner's order, with a search that matches category and subcategory names.
 */
@Component({
  selector: 'app-category-picker',
  imports: [CategoryIconComponent],
  template: `
    <div data-picker class="flex flex-col gap-3">
      <input
        data-category-search
        type="search"
        placeholder="Sök kategori"
        aria-label="Sök kategori"
        class="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
      @for (group of shown(); track group.category.id) {
        <section data-picker-category>
          <h3
            data-picker-category-name
            class="mb-1 text-sm font-semibold text-zinc-500 dark:text-zinc-400"
          >
            {{ group.category.name }}
          </h3>
          <ul>
            @for (subcategory of group.subcategories; track subcategory.id) {
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  [attr.data-subcategory]="subcategory.id"
                  (click)="picked.emit(subcategory.id)"
                >
                  <app-category-icon [icon]="subcategory.icon" [colour]="group.category.colour" />
                  {{ subcategory.name }}
                </button>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p data-picker-empty class="text-zinc-500 dark:text-zinc-400">Inga träffar</p>
      }
    </div>
  `,
})
export class CategoryPickerComponent {
  readonly categories = input.required<Category[]>();
  /** The id of the subcategory the owner chose. */
  readonly picked = output<number>();

  protected readonly query = signal('');

  /** A category whose name matches shows all its subcategories, otherwise only those that match. */
  protected readonly shown = computed(() => {
    const query = fold(this.query().trim());
    return this.categories()
      .map((category) => ({
        category,
        subcategories: fold(category.name).includes(query)
          ? category.subcategories
          : category.subcategories.filter((s) => fold(s.name).includes(query)),
      }))
      .filter((group) => group.subcategories.length > 0);
  });
}
