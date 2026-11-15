import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Toast } from './toast/toast';
import { TransactionsService } from './transactions.service';

interface NavItem {
  readonly path: string;
  readonly label: string;
  /** Shorter label for the bottom tabs. */
  readonly tabLabel: string;
  readonly exact: boolean;
  /** Path data of the 24×24 stroke icon. */
  readonly icon: readonly string[];
  readonly reviewCount?: true;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/',
    label: 'Översikt',
    tabLabel: 'Översikt',
    exact: true,
    icon: ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'],
  },
  {
    path: '/transaktioner',
    label: 'Transaktioner',
    tabLabel: 'Transaktioner',
    exact: false,
    icon: ['M8 6h13M8 12h13M8 18h13', 'M3 6h.01M3 12h.01M3 18h.01'],
  },
  {
    path: '/granska',
    label: 'Att granska',
    tabLabel: 'Granska',
    exact: false,
    icon: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'm8 12.5 2.8 2.8L16 9.5'],
    reviewCount: true,
  },
  {
    path: '/avrakning',
    label: 'Delat',
    tabLabel: 'Delat',
    exact: false,
    icon: ['M8 3 4 7l4 4', 'M4 7h16', 'm16 21 4-4-4-4', 'M20 17H4'],
  },
  {
    path: '/banker',
    label: 'Banker',
    tabLabel: 'Banker',
    exact: false,
    icon: ['M3 10 12 4l9 6', 'M5 10v8M9.5 10v8M14.5 10v8M19 10v8', 'M3 21h18'],
  },
];

const LOGOUT_ICON = ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'];

@Component({
  selector: 'app-root',
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, RouterOutlet, Toast],
  template: `
    <ng-template #icon let-paths let-size="size">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="nav-icon shrink-0"
        [class.size-5]="size === 20"
        [class.size-6]="size === 24"
        aria-hidden="true"
      >
        @for (d of paths; track d) {
          <path [attr.d]="d" />
        }
      </svg>
    </ng-template>

    <aside
      class="fixed inset-y-0 left-0 z-20 hidden w-[236px] flex-col border-r border-line bg-sidebar px-3 py-5 sm:flex"
    >
      <a routerLink="/" class="mb-6 px-3 font-display text-xl font-bold tracking-tight">Bankapp</a>
      <nav aria-label="Huvudmeny" class="flex flex-1 flex-col gap-1">
        @for (item of items; track item.path) {
          <a
            [routerLink]="item.path"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
            [routerLinkActiveOptions]="{ exact: item.exact }"
            [attr.aria-label]="item.reviewCount ? reviewLabel() : null"
            class="nav-link"
          >
            <ng-container *ngTemplateOutlet="icon; context: { $implicit: item.icon, size: 20 }" />
            <span class="flex-1">{{ item.label }}</span>
            @if (item.reviewCount && reviewCount() > 0) {
              <span data-review-badge aria-hidden="true" class="nav-badge">{{
                reviewBadge()
              }}</span>
            }
          </a>
        }
      </nav>
      <div class="flex items-center gap-3 border-t border-line px-3 pt-4">
        <span
          class="grid size-8 place-content-center rounded-full bg-surface-3 text-sm font-semibold"
          aria-hidden="true"
          >Ä</span
        >
        <span class="flex-1 text-sm text-muted">Ägare</span>
        <button
          type="button"
          class="btn btn-ghost btn-sm size-9 px-0"
          aria-label="Logga ut"
          disabled
        >
          <ng-container *ngTemplateOutlet="icon; context: { $implicit: logoutIcon, size: 20 }" />
        </button>
      </div>
    </aside>

    <header
      class="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur sm:hidden"
    >
      <a routerLink="/" class="font-display text-lg font-bold tracking-tight">Bankapp</a>
      <button type="button" class="btn btn-ghost btn-sm size-9 px-0" aria-label="Logga ut" disabled>
        <ng-container *ngTemplateOutlet="icon; context: { $implicit: logoutIcon, size: 20 }" />
      </button>
    </header>

    <div class="pb-[calc(76px+env(safe-area-inset-bottom))] sm:pb-0 sm:pl-[236px]">
      <router-outlet />
    </div>

    <nav
      data-tabs
      aria-label="Flikar"
      class="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-sidebar pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      @for (item of items; track item.path) {
        <a
          [routerLink]="item.path"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
          [routerLinkActiveOptions]="{ exact: item.exact }"
          [attr.aria-label]="item.reviewCount ? reviewLabel() : null"
          class="tab-link"
        >
          <span class="relative">
            <ng-container *ngTemplateOutlet="icon; context: { $implicit: item.icon, size: 24 }" />
            @if (item.reviewCount && reviewCount() > 0) {
              <span
                data-review-badge
                aria-hidden="true"
                class="nav-badge absolute -top-1.5 left-3 h-4 min-w-4 px-1 text-[10px]"
                >{{ reviewBadge() }}</span
              >
            }
          </span>
          <span>{{ item.tabLabel }}</span>
        </a>
      }
    </nav>

    <app-toast />
  `,
})
export class App {
  private readonly transactions = inject(TransactionsService);
  protected readonly reviewCount = this.transactions.reviewCount;
  protected readonly items = NAV_ITEMS;
  protected readonly logoutIcon = LOGOUT_ICON;
  protected readonly reviewBadge = computed(() =>
    this.reviewCount() > 99 ? '99+' : String(this.reviewCount()),
  );
  protected readonly reviewLabel = computed(() =>
    this.reviewCount() > 0 ? 'Granska, ' + this.reviewCount() + ' att granska' : 'Granska',
  );

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
