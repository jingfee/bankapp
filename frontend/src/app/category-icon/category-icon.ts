import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { CATEGORY_PALETTE, type CategoryColour, type CategoryIcon } from '@bankapp/shared';
import { LUCIDE_ICONS } from './lucide-icons';

/**
 * A category's or subcategory's icon: flat, a rounded square tinted by the category's colour with
 * a lighter stroke and a faint ring (see `.category-icon` in styles.css). A guess carries a small
 * "?" badge and a pending transaction a dashed outline.
 */
@Component({
  selector: 'app-category-icon',
  host: { class: 'inline-flex' },
  template: `
    <span
      data-badge
      class="category-icon"
      [class.category-icon-guessed]="guessed()"
      [class.category-icon-pending]="pending()"
      [style.--size.px]="size()"
      [style.--category-colour]="palette().colour"
      [style.--category-tint]="palette().tint"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label() ?? null"
    >
      <span class="contents" [innerHTML]="svg()"></span>
      @if (guessed()) {
        <span data-guess-mark class="category-icon-mark" aria-hidden="true">?</span>
      }
    </span>
  `,
})
export class CategoryIconComponent {
  readonly icon = input.required<CategoryIcon>();
  readonly colour = input.required<CategoryColour>();
  /** What the icon stands for, e.g. the subcategory's name; without it the icon is decorative. */
  readonly label = input<string>();
  readonly size = input<28 | 36 | 40 | 60>(40);
  /** The category is only a guess, not yet confirmed by the owner. */
  readonly guessed = input(false);
  /** The transaction is still pending at the bank. */
  readonly pending = input(false);

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly palette = computed(() => CATEGORY_PALETTE[this.colour()]);

  /** Built only from the bundled icon data, never from input, so it is safe to trust. */
  protected readonly svg = computed<SafeHtml>(() => {
    const glyph = Math.round(this.size() * 0.45);
    const shapes = LUCIDE_ICONS[this.icon()]
      .map(([tag, attributes]) => {
        const rendered = Object.entries(attributes)
          .map(([name, value]) => `${name}="${String(value)}"`)
          .join(' ');
        return `<${tag} ${rendered}/>`;
      })
      .join('');
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${glyph}" height="${glyph}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`,
    );
  });
}
