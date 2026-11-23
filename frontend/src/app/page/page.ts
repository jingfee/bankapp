import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The shell every routed page sits in: the `<main>` with its width, padding and vertical rhythm,
 * and the page header (back link, title, subtitle, actions). On phones the header sticks to the
 * top, translucent, since the app has no global top bar there.
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
      class="mx-auto flex flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-6 sm:py-10"
      [class.max-w-2xl]="width() === 'narrow'"
      [class.max-w-5xl]="width() === 'wide'"
    >
      <header
        data-page-header
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 max-sm:sticky max-sm:top-[env(safe-area-inset-top)] max-sm:z-10 max-sm:-mx-4 max-sm:-mt-6 max-sm:bg-bg/85 max-sm:px-4 max-sm:py-3 max-sm:backdrop-blur-md"
      >
        <div class="flex min-w-0 flex-col items-start gap-1">
          <ng-content select="[page-back]" />
          @if (title(); as heading) {
            <h1 data-page-title class="page-title">{{ heading }}</h1>
          }
          <ng-content select="[page-title]" />
          @if (subtitle(); as text) {
            <p data-page-subtitle class="text-muted">{{ text }}</p>
          }
          <ng-content select="[page-subtitle]" />
        </div>
        <ng-content select="[page-actions]" />
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
}
