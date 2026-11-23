import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

/**
 * The shell every routed page sits in: the `<main>` with its width, padding and vertical rhythm,
 * and the page header (back link, title, subtitle, actions). On phones the title row sticks to the
 * top, translucent with a border once scrolled, since the app has no global top bar there; the
 * subtitle scrolls away.
 *
 * Slots (all optional):
 * - `[page-back]`: a back link above the title;
 * - `[page-title]`: replaces the plain `title` with custom content (Översikt's month stepper);
 * - `[page-subtitle]`: replaces the plain `subtitle` with custom content (Banker's sync status);
 * - `[page-actions]`: sits to the right of the title and wraps below it when there is no room.
 *
 * Everything else is the page body.
 */
@Component({
  selector: 'app-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="relative mx-auto flex flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-6 sm:py-10"
      [class.max-w-2xl]="width() === 'narrow'"
      [class.max-w-5xl]="width() === 'wide'"
    >
      <div
        #sentinel
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 top-0 h-px sm:hidden"
      ></div>
      <header data-page-header class="max-sm:contents sm:flex sm:flex-col sm:gap-1">
        <div
          data-page-header-row
          class="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 border-b border-transparent max-sm:sticky max-sm:top-[env(safe-area-inset-top)] max-sm:z-10 max-sm:-mx-4 max-sm:-mt-6 max-sm:bg-bg/85 max-sm:px-4 max-sm:py-3 max-sm:backdrop-blur-md"
          [class.max-sm:border-line]="stuck()"
          [attr.data-stuck]="stuck() ? '' : null"
        >
          <div class="flex min-w-0 flex-col items-start gap-1">
            <ng-content select="[page-back]" />
            @if (title(); as heading) {
              <h1 data-page-title class="page-title">{{ heading }}</h1>
            }
            <ng-content select="[page-title]" />
          </div>
          <ng-content select="[page-actions]" />
        </div>
        @if (subtitle(); as text) {
          <p data-page-subtitle class="text-muted max-sm:-mt-3">{{ text }}</p>
        }
        <ng-content select="[page-subtitle]" />
      </header>
      <ng-content />
    </main>
  `,
})
export class Page {
  /** `narrow` = 672 px max, `wide` = 1024 px max. */
  readonly width = input<'narrow' | 'wide'>('wide');
  readonly title = input<string>();
  readonly subtitle = input<string>();

  private readonly sentinel = viewChild.required<ElementRef<HTMLElement>>('sentinel');
  /** True once the page has scrolled under the sticky phone header. */
  protected readonly stuck = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(([entry]) =>
        this.stuck.set(!!entry && !entry.isIntersecting),
      );
      observer.observe(this.sentinel().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
