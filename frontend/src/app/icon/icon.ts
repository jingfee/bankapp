import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { IconNode } from 'lucide';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Inbox,
  Info,
  Landmark,
  PiggyBank,
  Plus,
  Receipt,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide';

/** The Lucide icons the interface uses outside categories. Add one here before using it. */
const ICONS = {
  check: Check,
  'chevron-down': ChevronDown,
  'circle-alert': CircleAlert,
  inbox: Inbox,
  info: Info,
  landmark: Landmark,
  'piggy-bank': PiggyBank,
  plus: Plus,
  receipt: Receipt,
  search: Search,
  trash: Trash2,
  'triangle-alert': TriangleAlert,
  x: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/** A decorative Lucide icon that takes the current text colour. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex flex-none', 'aria-hidden': 'true' },
  template: `<span class="contents" [innerHTML]="svg()"></span>`,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);

  private readonly sanitizer = inject(DomSanitizer);

  /** Built only from the bundled icon data, never from input, so it is safe to trust. */
  protected readonly svg = computed<SafeHtml>(() => {
    const size = this.size();
    const shapes = ICONS[this.name()]
      .map(([tag, attributes]) => {
        const rendered = Object.entries(attributes)
          .map(([key, value]) => `${key}="${String(value)}"`)
          .join(' ');
        return `<${tag} ${rendered}/>`;
      })
      .join('');
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`,
    );
  });
}
