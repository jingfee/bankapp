import { Location, NgTemplateOutlet } from '@angular/common';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { Toast } from './toast/toast';
import { ToastService } from './toast/toast.service';
import { APP_TIMEZONE } from './formatting/date-time.pipe';
import { CategoriesService } from './categories.service';
import { SyncStatusService } from './sync-status.service';
import { TransactionsService } from './transactions.service';

interface NavItem {
  readonly path: string;
  readonly label: string;
  /** Shorter label for the bottom tabs. */
  readonly tabLabel: string;
  /** Short label under the icon of the 84 px rail; must fit without truncating. */
  readonly railLabel: string;
  readonly exact: boolean;
  /** Other routes that belong to this item and highlight it (Anslut bank belongs to Banker). */
  readonly alsoPaths?: readonly string[];
  /** Path data of the 24×24 stroke icon. */
  readonly icon: readonly string[];
  readonly reviewCount?: true;
  /** Lives in the Mer sheet of the bottom tabs instead of a tab of its own. */
  readonly more?: true;
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/',
    label: 'Översikt',
    tabLabel: 'Översikt',
    railLabel: 'Översikt',
    exact: true,
    icon: ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'],
  },
  {
    path: '/transaktioner',
    label: 'Transaktioner',
    tabLabel: 'Transaktioner',
    railLabel: 'Transaktioner',
    exact: false,
    icon: ['M8 6h13M8 12h13M8 18h13', 'M3 6h.01M3 12h.01M3 18h.01'],
  },
  {
    path: '/granska',
    label: 'Att granska',
    tabLabel: 'Granska',
    railLabel: 'Granska',
    exact: false,
    icon: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'm8 12.5 2.8 2.8L16 9.5'],
    reviewCount: true,
  },
  {
    path: '/delat',
    label: 'Delat',
    tabLabel: 'Delat',
    railLabel: 'Delat',
    exact: false,
    icon: ['M8 3 4 7l4 4', 'M4 7h16', 'm16 21 4-4-4-4', 'M20 17H4'],
  },
  {
    path: '/sparande',
    more: true,
    label: 'Sparande',
    tabLabel: 'Sparande',
    railLabel: 'Sparande',
    exact: false,
    icon: ['M4 19h16', 'M6 16v-5M10 16V8M14 16v-3M18 16V6'],
  },
  {
    path: '/bolan',
    more: true,
    label: 'Bolån',
    tabLabel: 'Bolån',
    railLabel: 'Bolån',
    exact: false,
    icon: ['M3 11 12 4l9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  },
  {
    path: '/banker',
    alsoPaths: ['/anslut-bank'],
    more: true,
    label: 'Banker',
    tabLabel: 'Banker',
    railLabel: 'Banker',
    exact: false,
    icon: ['M3 10 12 4l9 6', 'M5 10v8M9.5 10v8M14.5 10v8M19 10v8', 'M3 21h18'],
  },
];

const DAY_FORMAT = new Intl.DateTimeFormat('sv-SE', { timeZone: APP_TIMEZONE });
const TIME_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const MORE_ICON = ['M5 12h.01M12 12h.01M19 12h.01'];

const LOGOUT_ICON = ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'];

@Component({
  selector: 'app-root',
  imports: [NgTemplateOutlet, RouterLink, RouterOutlet, Toast],
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

    <ng-template #syncLine>
      @if (syncText(); as text) {
        <p data-sync-line class="mb-3 flex items-center gap-2 px-3 text-xs text-muted">
          <span
            data-sync-dot
            class="size-2 shrink-0 rounded-full"
            [class.bg-positive]="!syncStatus.lastFailed()"
            [class.bg-warning]="syncStatus.lastFailed()"
            aria-hidden="true"
          ></span>
          <span>{{ text }}</span>
        </p>
      }
    </ng-template>

    @if (!onLoginPage()) {
      <aside
        class="fixed inset-y-0 left-0 z-20 hidden w-[236px] flex-col border-r border-line bg-sidebar px-3 py-5 lg:flex"
      >
        <a routerLink="/" class="mb-6 px-3 font-display text-xl font-bold tracking-tight"
          >Bankapp</a
        >
        <nav aria-label="Huvudmeny" class="flex flex-1 flex-col gap-1">
          @for (item of items; track item.path) {
            <a
              [routerLink]="item.path"
              [class.active]="isActive(item)"
              [attr.aria-current]="isActive(item) ? 'page' : null"
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
              @if (item.path === '/banker' && attention()) {
                <span
                  data-attention
                  class="size-2 rounded-full bg-warning"
                  role="img"
                  [attr.aria-label]="expiryLabel()"
                ></span>
              }
            </a>
          }
        </nav>
        <ng-container *ngTemplateOutlet="syncLine" />
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
            (click)="logout()"
          >
            <ng-container *ngTemplateOutlet="icon; context: { $implicit: logoutIcon, size: 20 }" />
          </button>
        </div>
      </aside>

      <aside
        data-rail
        class="fixed inset-y-0 left-0 z-20 hidden w-[84px] flex-col items-center border-r border-line bg-sidebar py-4 sm:flex lg:hidden"
      >
        <button
          type="button"
          data-rail-logo
          class="mb-5 grid size-10 place-content-center rounded-xl bg-accent font-display text-lg font-bold text-on-accent"
          aria-label="Meny"
          aria-haspopup="menu"
          [attr.aria-expanded]="railMenuOpen()"
          (click)="railMenuOpen.set(!railMenuOpen())"
        >
          B
        </button>
        @if (railMenuOpen()) {
          <button
            type="button"
            data-rail-backdrop
            tabindex="-1"
            aria-label="Stäng"
            class="fixed inset-0 z-30 cursor-default"
            (click)="railMenuOpen.set(false)"
          ></button>
          <div
            data-rail-menu
            role="menu"
            class="absolute top-16 left-3 z-40 flex w-44 flex-col gap-1 rounded-xl border border-line-strong bg-surface-2 p-2"
          >
            <span class="px-3 py-2 text-sm text-muted">Ägare</span>
            <ng-container *ngTemplateOutlet="syncLine" />
            <button
              type="button"
              role="menuitem"
              class="nav-link border-t border-line"
              aria-label="Logga ut"
              (click)="logout()"
            >
              <ng-container
                *ngTemplateOutlet="icon; context: { $implicit: logoutIcon, size: 20 }"
              />
              <span class="flex-1 text-left">Logga ut</span>
            </button>
          </div>
        }
        <nav aria-label="Huvudmeny" class="flex flex-1 flex-col items-center gap-1">
          @for (item of items; track item.path) {
            <a
              [routerLink]="item.path"
              [class.active]="isActive(item)"
              [attr.aria-current]="isActive(item) ? 'page' : null"
              [attr.aria-label]="item.reviewCount ? reviewLabel() : null"
              class="rail-link"
            >
              <span class="rail-pill relative">
                <ng-container
                  *ngTemplateOutlet="icon; context: { $implicit: item.icon, size: 24 }"
                />
                @if (item.reviewCount && reviewCount() > 0) {
                  <span
                    data-review-badge
                    aria-hidden="true"
                    class="nav-badge absolute -top-1 left-5 h-4 min-w-4 px-1 text-[10px]"
                    >{{ reviewBadge() }}</span
                  >
                }
                @if (item.path === '/banker' && attention()) {
                  <span
                    data-attention
                    class="absolute top-0 left-7 size-2 rounded-full bg-warning"
                    role="img"
                    [attr.aria-label]="expiryLabel()"
                  ></span>
                }
              </span>
              <span>{{ item.railLabel }}</span>
            </a>
          }
        </nav>
      </aside>
    }

    <div
      [class]="
        onLoginPage()
          ? ''
          : 'pb-[calc(64px+env(safe-area-inset-bottom))] sm:pb-0 sm:pl-[84px] lg:pl-[236px]'
      "
    >
      <router-outlet />
    </div>

    @if (!onLoginPage()) {
      <nav
        data-tabs
        aria-label="Flikar"
        class="fixed inset-x-0 bottom-0 z-30 flex h-[calc(64px+env(safe-area-inset-bottom))] border-t border-line bg-sidebar pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        @for (item of tabItems; track item.path) {
          <a
            [routerLink]="item.path"
            [class.active]="isActive(item)"
            [attr.aria-current]="isActive(item) ? 'page' : null"
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
            <span class="tab-label">{{ item.tabLabel }}</span>
          </a>
        }
        <button
          type="button"
          data-more
          class="tab-link"
          [class.active]="moreOpen() || moreCurrent() !== null"
          aria-haspopup="dialog"
          [attr.aria-expanded]="moreOpen()"
          (click)="moreOpen.set(!moreOpen())"
        >
          <span class="relative">
            <ng-container
              *ngTemplateOutlet="
                icon;
                context: { $implicit: moreCurrent()?.icon ?? moreIcon, size: 24 }
              "
            />
            @if (attention()) {
              <span
                data-attention
                class="absolute -top-0.5 -right-1 size-2 rounded-full bg-warning"
                aria-hidden="true"
              ></span>
            }
          </span>
          <span class="tab-label">{{ moreCurrent()?.tabLabel ?? 'Mer' }}</span>
        </button>
      </nav>
    }

    @if (!onLoginPage() && moreOpen()) {
      <button
        type="button"
        data-more-backdrop
        tabindex="-1"
        aria-label="Stäng"
        class="sheet-backdrop fixed inset-0 z-20 cursor-default bg-black/60 sm:hidden"
        (click)="moreOpen.set(false)"
      ></button>
      <div
        data-more-sheet
        role="dialog"
        aria-label="Mer"
        class="sheet fixed inset-x-2 bottom-[calc(64px+env(safe-area-inset-bottom)+8px)] z-[25] flex flex-col gap-1 rounded-2xl border border-line-strong bg-surface-2 px-3 pt-2 pb-3 sm:hidden"
      >
        <span
          data-more-handle
          class="mx-auto mb-1 h-1 w-9 rounded-full bg-line-strong"
          aria-hidden="true"
        ></span>
        <span class="px-3 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">Mer</span>
        @for (item of moreItems; track item.path) {
          <a
            [routerLink]="item.path"
            [class.active]="isActive(item)"
            [attr.aria-current]="isActive(item) ? 'page' : null"
            class="nav-link"
          >
            <ng-container *ngTemplateOutlet="icon; context: { $implicit: item.icon, size: 20 }" />
            <span class="flex-1">{{ item.label }}</span>
            @if (item.path === '/banker' && attention()) {
              <span data-status-pill class="pill pill-guess">{{ expiryPill() }}</span>
            }
          </a>
        }
        <div class="mt-1 flex items-center gap-3 border-t border-line px-3 pt-3">
          <span
            class="grid size-8 place-content-center rounded-full bg-surface-3 text-sm font-semibold"
            aria-hidden="true"
            >Ä</span
          >
          <span class="flex flex-1 flex-col">
            <span class="text-sm">Ägare</span>
            @if (syncText(); as text) {
              <span class="text-xs text-muted">{{ text }}</span>
            }
          </span>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Logga ut"
            (click)="logout()"
          >
            Logga ut
          </button>
        </div>
      </div>
    }

    <app-toast />
  `,
})
export class App {
  @HostListener('document:keydown.escape')
  protected closeMore(): void {
    this.moreOpen.set(false);
    this.railMenuOpen.set(false);
  }

  private readonly transactions = inject(TransactionsService);
  private readonly categories = inject(CategoriesService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly onLoginPage = signal(inject(Location).path().startsWith('/logga-in'));
  protected readonly reviewCount = this.transactions.reviewCount;
  protected readonly items = NAV_ITEMS;
  protected readonly tabItems = NAV_ITEMS.filter((item) => !item.more);
  protected readonly moreItems = NAV_ITEMS.filter((item) => item.more);
  protected readonly moreIcon = MORE_ICON;
  protected readonly moreOpen = signal(false);
  protected readonly syncStatus = inject(SyncStatusService);
  private readonly url = signal(this.router.url);
  protected readonly railMenuOpen = signal(false);
  /** The item of the current page when it lives in the Mer sheet; shown on the fifth tab. */
  protected readonly moreCurrent = computed(
    () => this.moreItems.find((item) => this.isActive(item)) ?? null,
  );
  protected readonly attention = computed(() => this.syncStatus.expiringCount() > 0);
  protected readonly expiryPill = computed(() => `${this.syncStatus.expiringCount()} går ut`);
  protected readonly expiryLabel = computed(() =>
    this.syncStatus.expiringCount() === 1
      ? 'En bankkoppling går ut'
      : `${this.syncStatus.expiringCount()} bankkopplingar går ut`,
  );
  /** "Uppdaterad idag 11:00", from what Banker last fetched. */
  protected readonly syncText = computed(() => {
    const at = this.syncStatus.lastSyncedAt();
    if (!at) return null;
    const date = new Date(at);
    const day = (value: Date) => DAY_FORMAT.format(value);
    return day(date) === day(new Date())
      ? `Uppdaterad idag ${TIME_FORMAT.format(date)}`
      : `Uppdaterad ${DAY_FORMAT.format(date)} ${TIME_FORMAT.format(date)}`;
  });
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
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.onLoginPage.set(event.urlAfterRedirects.startsWith('/logga-in'));
        this.moreOpen.set(false);
        this.railMenuOpen.set(false);
        this.url.set(event.urlAfterRedirects);
        if (this.onLoginPage()) this.syncStatus.reset();
        if (!this.onLoginPage()) this.transactions.refreshReviewCount();
      });
  }

  protected isActive(item: NavItem): boolean {
    const path = this.url().split(/[?#]/)[0];
    const matches = (base: string) =>
      item.exact && base === item.path
        ? path === base
        : path === base || path.startsWith(base + '/');
    return matches(item.path) || (item.alsoPaths ?? []).some(matches);
  }

  protected logout(): void {
    this.moreOpen.set(false);
    this.railMenuOpen.set(false);
    this.auth.logout().subscribe({
      next: () => {
        this.transactions.reviewCount.set(0);
        this.syncStatus.reset();
        this.categories.reset();
        void this.router.navigateByUrl('/logga-in');
      },
      error: () => this.toast.show('Det gick inte att logga ut. Försök igen.'),
    });
  }
}
