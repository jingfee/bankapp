import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { CATEGORY_PALETTE, type CategoryColour, type CategoryIcon } from '@bankapp/shared';
import { LUCIDE_ICONS } from './lucide-icons';

/**
 * A category's or subcategory's icon, drawn white on the category's colour. The colour has a
 * light and a dark value; CSS picks one by the operating system's colour scheme.
 */
@Component({
  selector: 'app-category-icon',
  host: { class: 'inline-flex' },
  template: `
    <span
      data-badge
      class="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-(--category-light) text-white dark:bg-(--category-dark)"
      [style.--category-light]="palette().light"
      [style.--category-dark]="palette().dark"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label() ?? null"
      [innerHTML]="svg()"
    ></span>
  `,
})
export class CategoryIconComponent {
  readonly icon = input.required<CategoryIcon>();
  readonly colour = input.required<CategoryColour>();
  /** What the icon stands for, e.g. the subcategory's name; without it the icon is decorative. */
  readonly label = input<string>();

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly palette = computed(() => CATEGORY_PALETTE[this.colour()]);

  /** Built only from the bundled icon data, never from input, so it is safe to trust. */
  protected readonly svg = computed<SafeHtml>(() => {
    const shapes = LUCIDE_ICONS[this.icon()]
      .map(([tag, attributes]) => {
        const rendered = Object.entries(attributes)
          .map(([name, value]) => `${name}="${String(value)}"`)
          .join(' ');
        return `<${tag} ${rendered}/>`;
      })
      .join('');
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`,
    );
  });
}
