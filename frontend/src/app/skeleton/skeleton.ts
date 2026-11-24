import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Placeholder blocks shaped like the content that is loading, so the layout does not jump when
 * it arrives. The page marks its region `aria-busy`; the blocks themselves are hidden from
 * assistive technology and do not animate under `prefers-reduced-motion`.
 *
 * - `rows`: a list of lines (transactions, accounts);
 * - `tiles`: a row of stat tiles;
 * - `summary`: one tall card for a headline figure with a bar and boxes;
 * - `card`: one card-sized block.
 */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'block' },
  template: `
    @switch (shape()) {
      @case ('tiles') {
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          @for (n of items(); track n) {
            <div class="skeleton h-20 rounded-2xl"></div>
          }
        </div>
      }
      @case ('summary') {
        <div class="skeleton h-64 rounded-[20px] lg:h-44"></div>
      }
      @case ('card') {
        <div class="skeleton h-40 rounded-[20px]"></div>
      }
      @default {
        <div class="card divide-y divide-line">
          @for (n of items(); track n) {
            <div class="flex items-center gap-3 p-4">
              <div class="skeleton size-10 flex-none rounded-xl"></div>
              <div class="flex flex-1 flex-col gap-2">
                <div class="skeleton h-3.5 w-2/5 rounded"></div>
                <div class="skeleton h-3 w-1/4 rounded"></div>
              </div>
              <div class="skeleton h-4 w-16 rounded"></div>
            </div>
          }
        </div>
      }
    }
  `,
})
export class Skeleton {
  readonly shape = input<'rows' | 'tiles' | 'summary' | 'card'>('rows');
  readonly count = input(4);

  protected readonly items = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
