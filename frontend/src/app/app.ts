import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { TransactionsService } from './transactions.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  template: `
    <header
      class="mx-auto flex max-w-2xl items-center justify-between px-4 pt-6 text-zinc-900 dark:text-zinc-100"
    >
      <a routerLink="/" class="text-lg font-semibold tracking-tight">Bankapp</a>
      <nav aria-label="Huvudmeny" class="flex items-center gap-1">
        <a
          routerLink="/granska"
          [attr.aria-label]="
            reviewCount() > 0 ? 'Granska, ' + reviewCount() + ' att granska' : 'Granska'
          "
          class="relative rounded-lg p-2 hover:bg-zinc-200/60"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="size-6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="m8 12.5 2.8 2.8L16 9.5" />
          </svg>
          @if (reviewCount() > 0) {
            <span
              data-review-badge
              aria-hidden="true"
              class="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white tabular-nums"
              >{{ reviewCount() > 99 ? '99+' : reviewCount() }}</span
            >
          }
        </a>
        <a routerLink="/banker" aria-label="Banker" class="rounded-lg p-2 hover:bg-zinc-200/60">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="size-6"
            aria-hidden="true"
          >
            <path d="M3 10 12 4l9 6" />
            <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
            <path d="M3 21h18" />
          </svg>
        </a>
      </nav>
    </header>
    <router-outlet />
  `,
})
export class App {
  private readonly transactions = inject(TransactionsService);
  protected readonly reviewCount = this.transactions.reviewCount;

  constructor() {
    // The count changes with syncs and with what the owner categorises, so ask again on every
    // page change; it is a single cheap query.
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.transactions.refreshReviewCount());
  }
}
