import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type {
  ConnectedAccount,
  OverviewCategory,
  OverviewResponse,
  OverviewTotals,
  Transaction,
} from '@bankapp/shared';
import { type Subscription, catchError, of } from 'rxjs';
import { AccountsService } from '../../accounts.service';
import { CategoryBar } from '../../category-bar/category-bar';
import { MoneyPipe } from '../../formatting/money.pipe';
import { APP_LOCALE } from '../../formatting/locale';
import { OverviewService } from '../../overview.service';
import { TransactionList } from '../../transaction-list/transaction-list';

type Status = 'loading' | 'ready' | 'failed';
type TotalKind = keyof OverviewTotals;

interface Bar<T> {
  item: T;
  /** Share of the section's total, as a whole percentage. */
  share: number;
  /** Width relative to the largest bar of the group, as a whole percentage. */
  width: number;
}

const TOTALS: { kind: TotalKind; label: string }[] = [
  { kind: 'income', label: 'Inkomster' },
  { kind: 'spending', label: 'Utgifter' },
  { kind: 'net', label: 'Netto' },
];

function labelOf(kind: TotalKind): string {
  return TOTALS.find((total) => total.kind === kind)!.label;
}

const money = new MoneyPipe();

/** `YYYY-MM` of a date in the owner's own time. */
function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return monthOf(new Date(year, number - 1 + by, 1));
}

function bars<T extends { id: number; name: string; total: number }>(
  items: T[],
  sectionTotal: number,
): Bar<T>[] {
  const largest = Math.max(...items.map((i) => i.total), 0);
  return items.map((item) => ({
    item,
    share: sectionTotal > 0 ? Math.round((item.total / sectionTotal) * 100) : 0,
    width: largest > 0 ? Math.max(Math.round((item.total / largest) * 100), 0) : 0,
  }));
}

/** One calendar month: income, spending and net, and where the money went. */
@Component({
  selector: 'app-overview-page',
  imports: [RouterLink, MoneyPipe, CategoryBar, TransactionList],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      @if (expiringConnection()) {
        <p
          data-connection-banner
          class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          En koppling går ut eller har gått ut.
          <a routerLink="/banker" class="font-medium underline">Gå till Banker</a>
        </p>
      }

      @if (openAccounts(); as open) {
        <ul data-balance-strip class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          @for (account of open; track account.id) {
            <li
              class="flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-white px-4 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span data-account-name class="truncate text-sm text-zinc-500 dark:text-zinc-400">{{
                account.name
              }}</span>
              <span data-balance class="font-medium tabular-nums">{{
                account.balance ? (account.balance.amount | money: account.balance.currency) : '–'
              }}</span>
            </li>
          }
        </ul>
      }

      <header class="flex items-center justify-between">
        <button
          type="button"
          data-previous-month
          aria-label="Föregående månad"
          class="min-w-11 rounded-lg px-3 py-2 text-2xl hover:bg-zinc-200/60"
          (click)="go(-1)"
        >
          ‹
        </button>
        <h1 data-month class="text-2xl font-semibold tracking-tight">{{ monthTitle() }}</h1>
        <button
          type="button"
          data-next-month
          aria-label="Nästa månad"
          class="min-w-11 rounded-lg px-3 py-2 text-2xl hover:bg-zinc-200/60 disabled:opacity-30"
          [disabled]="!canGoForward()"
          (click)="go(1)"
        >
          ›
        </button>
      </header>

      @switch (status()) {
        @case ('loading') {
          <p aria-live="polite">Hämtar översikt…</p>
        }
        @case ('failed') {
          <p role="alert">Översikten kunde inte hämtas. Försök igen senare.</p>
        }
        @default {
          @if (overview(); as o) {
            <dl class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              @for (total of totalRows(); track total.kind) {
                <div
                  [attr.data-total]="total.kind"
                  class="flex flex-wrap items-baseline justify-between gap-x-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm sm:block dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <dt class="text-sm text-zinc-500 dark:text-zinc-400">{{ total.label }}</dt>
                  <dd data-amount class="font-semibold tabular-nums">{{ total.amount }}</dd>
                  <dd data-change class="basis-full text-xs text-zinc-500 dark:text-zinc-400">
                    {{ total.change }}
                  </dd>
                </div>
              }
            </dl>

            @if (spending().length === 0 && income().length === 0) {
              <p>Inga transaktioner den här månaden.</p>
              @if (!openAccounts()) {
                <a routerLink="/anslut-bank" class="self-start font-medium underline"
                  >Anslut bank</a
                >
              }
            }

            @for (section of sections(); track section.key) {
              @if (section.bars.length > 0) {
                <section
                  [attr.data-section]="section.key"
                  class="rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm sm:p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <h2 class="px-2 text-lg font-semibold">{{ section.title }}</h2>
                  <ul class="mt-2 flex flex-col">
                    @for (bar of section.bars; track bar.item.id) {
                      <li [attr.data-category-row]="bar.item.name">
                        <app-category-bar
                          [icon]="bar.item.icon"
                          [colour]="bar.item.colour"
                          [name]="bar.item.name"
                          [total]="bar.item.total"
                          [share]="bar.share"
                          [width]="bar.width"
                          [expanded]="openCategory() === bar.item.id"
                          (toggled)="toggleCategory(bar.item.id)"
                        />

                        @if (openCategory() === bar.item.id) {
                          <ul
                            class="mt-1 mb-2 ml-3 flex flex-col border-l border-zinc-200 pl-1 dark:border-zinc-700"
                          >
                            @for (sub of subBars(bar.item); track sub.item.id) {
                              <li [attr.data-subcategory-row]="sub.item.name">
                                <app-category-bar
                                  [icon]="sub.item.icon"
                                  [colour]="bar.item.colour"
                                  [name]="sub.item.name"
                                  [total]="sub.item.total"
                                  [share]="sub.share"
                                  [width]="sub.width"
                                  [expanded]="openSubcategory() === sub.item.id"
                                  (toggled)="toggleSubcategory(sub.item.id)"
                                />
                                @if (openSubcategory() === sub.item.id) {
                                  @if (subStatus() === 'failed') {
                                    <p role="alert" class="px-2 py-2">
                                      Transaktionerna kunde inte hämtas. Försök igen senare.
                                    </p>
                                  } @else if (subStatus() === 'loading') {
                                    <p aria-live="polite" class="px-2 py-2">
                                      Hämtar transaktioner…
                                    </p>
                                  } @else {
                                    <div class="mt-2 mb-3">
                                      <app-transaction-list
                                        [transactions]="subTransactions()"
                                        [compact]="true"
                                      />
                                    </div>
                                  }
                                }
                              </li>
                            }
                          </ul>
                        }
                      </li>
                    }
                  </ul>
                </section>
              }
            }

            @if (o.uncategorised > 0) {
              <a
                data-uncategorised-row
                routerLink="/granska"
                class="flex items-center justify-between rounded-2xl border border-dashed border-zinc-300 bg-white p-4 dark:border-zinc-600 dark:bg-zinc-900"
              >
                <span>Okategoriserat</span>
                <span class="font-medium tabular-nums"
                  >{{ o.uncategorised }}
                  {{ o.uncategorised === 1 ? 'transaktion' : 'transaktioner' }} ›</span
                >
              </a>
            }
          }
        }
      }
    </main>
  `,
})
export class OverviewPage {
  private readonly service = inject(OverviewService);
  /** Fetched once; the strip is a convenience, so a failure just leaves it out. */
  private readonly accounts = toSignal(
    inject(AccountsService)
      .list()
      .pipe(catchError(() => of(undefined))),
    { initialValue: undefined },
  );

  protected readonly openAccounts = computed<ConnectedAccount[] | null>(() => {
    const open =
      this.accounts()?.banks.flatMap((group) => group.accounts.filter((a) => !a.hidden)) ?? [];
    return open.length === 0 ? null : open;
  });

  protected readonly expiringConnection = computed(
    () => this.accounts()?.banks.some((group) => group.status !== 'active') ?? false,
  );

  private readonly currentMonth = monthOf(new Date());
  protected readonly month = signal(this.currentMonth);
  protected readonly status = signal<Status>('loading');
  protected readonly overview = signal<OverviewResponse | null>(null);
  protected readonly openCategory = signal<number | null>(null);
  protected readonly openSubcategory = signal<number | null>(null);
  protected readonly subStatus = signal<Status>('loading');
  protected readonly subTransactions = signal<Transaction[]>([]);

  private overviewRequest: Subscription | undefined;
  private subRequest: Subscription | undefined;

  protected readonly canGoForward = computed(() => this.month() < this.currentMonth);

  protected readonly monthTitle = computed(() => {
    const [year, number] = this.month().split('-').map(Number) as [number, number];
    return new Intl.DateTimeFormat(APP_LOCALE, { month: 'long', year: 'numeric' }).format(
      new Date(year, number - 1, 1),
    );
  });

  protected readonly income = computed(() =>
    (this.overview()?.categories ?? []).filter((c) => c.kind === 'income'),
  );
  protected readonly spending = computed(() =>
    (this.overview()?.categories ?? []).filter((c) => c.kind === 'expense'),
  );

  protected readonly sections = computed(() => {
    const o = this.overview();
    return [
      {
        key: 'spending',
        title: labelOf('spending'),
        bars: bars(this.spending(), o?.totals.spending ?? 0),
      },
      { key: 'income', title: labelOf('income'), bars: bars(this.income(), o?.totals.income ?? 0) },
    ];
  });

  protected readonly totalRows = computed(() => {
    const o = this.overview();
    if (o === null) return [];
    return TOTALS.map(({ kind, label }) => ({
      kind,
      label,
      amount: money.transform(o.totals[kind]),
      change: this.changeText(o.totals[kind] - o.previous[kind]),
    }));
  });

  constructor() {
    this.load();
  }

  /** A category's subcategories as bars, sharing out the category's own total. */
  protected subBars(category: OverviewCategory) {
    return bars(category.subcategories, category.total);
  }

  protected go(by: number): void {
    const next = shiftMonth(this.month(), by);
    if (next > this.currentMonth) return;
    this.month.set(next);
    this.load();
  }

  protected toggleCategory(id: number): void {
    this.closeSubcategory();
    this.openCategory.update((open) => (open === id ? null : id));
  }

  protected toggleSubcategory(id: number): void {
    if (this.openSubcategory() === id) {
      this.closeSubcategory();
      return;
    }
    this.subRequest?.unsubscribe();
    this.openSubcategory.set(id);
    this.subStatus.set('loading');
    this.subRequest = this.service.transactions(this.month(), id).subscribe({
      next: (response) => {
        this.subTransactions.set(response.transactions);
        this.subStatus.set('ready');
      },
      error: () => this.subStatus.set('failed'),
    });
  }

  private closeSubcategory(): void {
    this.subRequest?.unsubscribe();
    this.openSubcategory.set(null);
  }

  private load(): void {
    this.overviewRequest?.unsubscribe();
    this.closeSubcategory();
    this.openCategory.set(null);
    this.status.set('loading');
    this.overviewRequest = this.service.get(this.month()).subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.status.set('ready');
      },
      error: () => this.status.set('failed'),
    });
  }

  private changeText(change: number): string {
    const rounded = Math.round(change * 100) / 100;
    if (rounded === 0) return 'Oförändrat mot föregående månad';
    return `${rounded > 0 ? '+' : ''}${money.transform(rounded)} mot föregående månad`;
  }
}
