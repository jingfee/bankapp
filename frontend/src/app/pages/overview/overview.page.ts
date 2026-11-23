import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_PALETTE,
  type AccountType,
  type ConnectedAccount,
  type OverviewCategory,
  type OverviewResponse,
  type OverviewTotals,
  type OverviewView,
  type Transaction,
} from '@bankapp/shared';
import { type Subscription, catchError, of } from 'rxjs';
import { AccountsService } from '../../accounts.service';
import { dayOf, monthOf, shiftMonth } from '../../dates';
import { CategoryBar } from '../../category-bar/category-bar';
import { MoneyPipe } from '../../formatting/money.pipe';
import { APP_LOCALE } from '../../formatting/locale';
import { OverviewService } from '../../overview.service';
import { SettlementService } from '../../settlement.service';
import { TransactionList } from '../../transaction-list/transaction-list';
import { Callout } from '../../callout/callout';
import { Empty } from '../../empty/empty';
import { Page } from '../../page/page';
import { Skeleton } from '../../skeleton/skeleton';

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
  { kind: 'net', label: 'Netto' },
  { kind: 'income', label: 'Inkomster' },
  { kind: 'spending', label: 'Utgifter' },
];

const ACCOUNT_TYPES: Record<AccountType, string> = {
  payment: 'Betalkonto',
  savings: 'Sparkonto',
  card: 'Kortkonto',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The donut: radius and circumference of its ring, in the SVG's own units. */
const RADIUS = 48;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Space left between neighbouring segments. */
const SEGMENT_GAP = 1.5;

interface DonutSegment {
  id: number;
  name: string;
  colour: string;
  dash: string;
  offset: number;
}

/** The spending chart's drawing area, in the SVG's own units. */
const CHART_WIDTH = 300;
const CHART_HEIGHT = 120;

interface SpendingChart {
  /** `x,y` pairs of this month up to today (the whole month once it is over). */
  current: string;
  /** `x,y` pairs of the whole month before. */
  previous: string;
  summary: string;
  /** Accumulated spending per day; this month's stops at today. */
  currentDays: number[];
  previousDays: number[];
  /** Number of days on the x axis, the longer of the two months. */
  length: number;
  top: number;
  bottom: number;
  yTicks: { label: string; pct: number }[];
  xTicks: { label: string; pct: number }[];
}

interface ChartTip {
  /** Where the hovered day sits across the chart, as a percentage. */
  pct: number;
  current?: { date: string; amount: string; top: number };
  previous?: { date: string; amount: string; top: number };
}

const KR = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 0 });
const DAY_LONG = new Intl.DateTimeFormat(APP_LOCALE, { day: 'numeric', month: 'long' });

interface Tile {
  kind: TotalKind | 'savings' | 'settlement';
  label: string;
  amount: string;
  line: string;
  positive: boolean;
  link?: { path: string; params: Record<string, string> };
}

interface AccountRow {
  account: ConnectedAccount;
  bank: string;
}

const money = new MoneyPipe();

const SHORT_DAY = new Intl.DateTimeFormat(APP_LOCALE, { day: 'numeric', month: 'short' });
const MONTH_LONG = new Intl.DateTimeFormat(APP_LOCALE, { month: 'long' });

/** `2 nov` for a `YYYY-MM-DD` day. */
function shortDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return SHORT_DAY.format(new Date(year, month - 1, date)).replace('.', '');
}

/** `Oktober` for a `YYYY-MM` month. */
function monthName(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const name = MONTH_LONG.format(new Date(year, number - 1, 1));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const VIEWS: { view: OverviewView; label: string }[] = [
  { view: 'mine', label: 'Min andel' },
  { view: 'full', label: 'Hela beloppet' },
];

/** Where the chosen view is remembered on this device. */
const VIEW_KEY = 'overview-view';

function storedView(): OverviewView {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === 'mine' || stored === 'full') return stored;
  } catch {
    // Storage can be blocked; the default then applies.
  }
  return 'mine';
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
  imports: [
    Page,
    NgTemplateOutlet,
    RouterLink,
    MoneyPipe,
    CategoryBar,
    TransactionList,
    Callout,
    Empty,
    Skeleton,
  ],
  template: `
    <ng-template #tileBody let-tile>
      <span class="eyebrow">{{ tile.label }}</span>
      <span
        data-amount
        class="amount text-[17px] whitespace-nowrap sm:text-[21px]"
        [class.text-positive]="tile.positive"
        >{{ tile.amount }}</span
      >
      <span data-change class="text-xs leading-snug text-muted">{{ tile.line }}</span>
    </ng-template>

    <app-page>
      <div page-title class="flex items-center gap-1">
        <button
          type="button"
          data-previous-month
          aria-label="Föregående månad"
          class="btn btn-ghost size-10 px-0 text-2xl"
          (click)="go(-1)"
        >
          ‹
        </button>
        <h1 data-month class="page-title text-center whitespace-nowrap capitalize">
          {{ monthTitle() }}
        </h1>
        <button
          type="button"
          data-next-month
          aria-label="Nästa månad"
          class="btn btn-ghost size-10 px-0 text-2xl"
          [disabled]="!canGoForward()"
          (click)="go(1)"
        >
          ›
        </button>
      </div>

      <div
        page-actions
        role="group"
        aria-label="Visa"
        data-view-toggle
        class="segmented w-full sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none"
      >
        @for (option of views; track option.view) {
          <button
            type="button"
            [attr.data-view]="option.view"
            [attr.aria-pressed]="view() === option.view"
            (click)="setView(option.view)"
          >
            {{ option.label }}
          </button>
        }
      </div>

      @if (banner(); as b) {
        <app-callout data-connection-banner variant="warning">
          {{ b }}
          <a
            callout-action
            routerLink="/banker"
            class="shrink-0 font-semibold whitespace-nowrap text-accent"
            >Förnya →</a
          >
        </app-callout>
      }

      @switch (status()) {
        @case ('loading') {
          <div aria-busy="true" class="flex flex-col gap-4">
            <app-skeleton shape="tiles" [count]="5" />
            <app-skeleton shape="card" />
          </div>
        }
        @case ('failed') {
          <app-callout variant="danger"
            >Översikten kunde inte hämtas. Försök igen senare.</app-callout
          >
        }
        @default {
          @if (overview(); as o) {
            <div data-tiles class="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-5">
              @for (tile of tiles(); track tile.kind) {
                @if (tile.link; as link) {
                  <a
                    [attr.data-total]="tile.kind"
                    [attr.data-total-link]="tile.kind === 'settlement' ? null : ''"
                    [routerLink]="link.path"
                    [queryParams]="link.params"
                    class="stat-tile"
                    [class.stat-tile-violet]="tile.kind === 'settlement'"
                  >
                    <ng-container *ngTemplateOutlet="tileBody; context: { $implicit: tile }" />
                  </a>
                } @else {
                  <div
                    [attr.data-total]="tile.kind"
                    class="stat-tile"
                    [class.stat-tile-positive]="tile.positive"
                  >
                    <ng-container *ngTemplateOutlet="tileBody; context: { $implicit: tile }" />
                  </div>
                }
              }
            </div>

            @if (spending().length === 0 && income().length === 0) {
              <app-empty icon="receipt" text="Inga transaktioner den här månaden.">
                @if (!accountRows()) {
                  <a empty-action routerLink="/anslut-bank" class="btn btn-secondary btn-sm"
                    >Anslut bank</a
                  >
                }
              </app-empty>
            }

            <div
              class="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-5 xl:items-start"
              [class.xl:grid-cols-[minmax(0,1fr)_320px]]="accountRows()"
            >
              <div class="flex min-w-0 flex-col gap-4 sm:gap-5">
                @if (chart(); as c) {
                  <section data-spending-chart class="card min-w-0 p-4 sm:p-5">
                    <h2 class="mb-1 card-title">Utgifter jämfört med förra månaden</h2>
                    <p data-spending-chart-summary class="mb-4 text-sm text-muted">
                      {{ c.summary }}
                    </p>
                    <div class="flex min-w-0 gap-2">
                      <div class="relative h-36 w-14 shrink-0" aria-hidden="true">
                        @for (tick of c.yTicks; track tick.pct) {
                          <span
                            data-y-tick
                            class="absolute right-0 translate-y-1/2 text-[11px] whitespace-nowrap text-muted"
                            [style.bottom.%]="tick.pct"
                            >{{ tick.label }}</span
                          >
                        }
                      </div>
                      <div class="min-w-0 flex-1">
                        <div
                          data-chart-plot
                          class="relative h-36 touch-pan-y"
                          (pointerleave)="hoveredDay.set(null)"
                          (pointerdown)="touchDay($event)"
                          (pointermove)="touchDay($event)"
                        >
                          @for (tick of c.yTicks; track tick.pct) {
                            <div
                              class="absolute inset-x-0 border-t border-line"
                              [style.bottom.%]="tick.pct"
                            ></div>
                          }
                          <svg
                            viewBox="0 0 300 120"
                            class="absolute inset-0 size-full overflow-visible"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <polyline
                              data-line="previous"
                              [attr.points]="c.previous"
                              fill="none"
                              stroke="var(--color-muted)"
                              stroke-width="2"
                              stroke-dasharray="5 4"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              vector-effect="non-scaling-stroke"
                            />
                            <polyline
                              data-line="current"
                              [attr.points]="c.current"
                              fill="none"
                              stroke="var(--color-accent)"
                              stroke-width="3"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              vector-effect="non-scaling-stroke"
                            />
                          </svg>

                          @if (tip(); as t) {
                            <div
                              class="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
                              [style.left.%]="t.pct"
                            ></div>
                            @if (t.previous; as p) {
                              <span
                                class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted"
                                [style.left.%]="t.pct"
                                [style.top.%]="p.top"
                              ></span>
                            }
                            @if (t.current; as cur) {
                              <span
                                class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                                [style.left.%]="t.pct"
                                [style.top.%]="cur.top"
                              ></span>
                            }
                            <div
                              data-chart-tooltip
                              class="pointer-events-none absolute top-0 z-10 flex flex-col gap-1 rounded-[10px] border border-line-strong bg-surface-3 px-3 py-2 text-xs whitespace-nowrap shadow-lg"
                              [style.left.%]="t.pct"
                              [style.transform]="'translateX(-' + t.pct + '%)'"
                            >
                              @if (t.current; as cur) {
                                <span class="flex items-center gap-2"
                                  ><span class="size-2 rounded-full bg-accent"></span>{{ cur.date }}
                                  <span class="amount">{{ cur.amount }}</span></span
                                >
                              }
                              @if (t.previous; as p) {
                                <span class="flex items-center gap-2"
                                  ><span class="size-2 rounded-full bg-muted"></span>{{ p.date }}
                                  <span class="amount">{{ p.amount }}</span></span
                                >
                              }
                            </div>
                          }

                          @for (day of chartDays(); track day) {
                            <div
                              class="absolute inset-y-0"
                              [attr.data-chart-day]="day"
                              [style.left.%]="((day - 1.5) / (c.length - 1)) * 100"
                              [style.width.%]="100 / (c.length - 1)"
                              (pointerenter)="hoveredDay.set(day)"
                            ></div>
                          }
                        </div>
                        <div class="relative mt-1 h-4" aria-hidden="true">
                          @for (tick of c.xTicks; track tick.label) {
                            <span
                              data-x-tick
                              class="absolute text-[11px] text-muted"
                              [style.left.%]="tick.pct"
                              [style.transform]="'translateX(-' + tick.pct + '%)'"
                              >{{ tick.label }}</span
                            >
                          }
                        </div>
                      </div>
                    </div>
                    <p class="mt-3 flex gap-4 text-xs text-muted">
                      <span class="flex items-center gap-1.5"
                        ><span class="h-0.5 w-4 rounded bg-accent"></span>{{ monthTitle() }}</span
                      >
                      <span class="flex items-center gap-1.5"
                        ><span
                          class="h-0.5 w-4 rounded border-t-2 border-dashed border-muted"
                        ></span
                        >Förra månaden</span
                      >
                    </p>
                  </section>
                }

                @if (spending().length > 0 || income().length > 0) {
                  <section data-section="spending" class="card @container p-4 sm:p-5">
                    <h2 class="mb-4 card-title">Utgifter per kategori</h2>
                    @if (spending().length === 0) {
                      <app-empty icon="receipt" text="Inga utgifter den här månaden." />
                    } @else {
                      <div class="flex flex-col gap-5 @lg:flex-row @lg:items-start">
                        <div
                          data-donut
                          class="donut-enter relative mx-auto size-44 shrink-0 @lg:mx-0"
                        >
                          <svg
                            viewBox="0 0 120 120"
                            class="size-full -rotate-90"
                            aria-hidden="true"
                          >
                            <circle
                              cx="60"
                              cy="60"
                              r="48"
                              fill="none"
                              stroke="var(--color-surface-3)"
                              stroke-width="14"
                            />
                            @for (segment of donut(); track segment.id) {
                              <circle
                                [attr.data-segment]="segment.name"
                                cx="60"
                                cy="60"
                                r="48"
                                fill="none"
                                stroke-width="14"
                                [attr.stroke]="segment.colour"
                                [attr.stroke-dasharray]="segment.dash"
                                [attr.stroke-dashoffset]="segment.offset"
                              />
                            }
                          </svg>
                          <span
                            class="absolute inset-0 flex flex-col items-center justify-center text-center"
                          >
                            <span class="eyebrow">Utgifter</span>
                            <span data-donut-total class="amount text-base">{{
                              o.totals.spending | money
                            }}</span>
                          </span>
                        </div>

                        <ul class="flex min-w-0 flex-1 flex-col">
                          @for (bar of spendingBars(); track bar.item.id) {
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
                                  class="expand-in mt-1 mb-2 ml-4 flex flex-col border-l border-line pl-1"
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
                                          <app-callout variant="danger" class="my-2">
                                            Transaktionerna kunde inte hämtas. Försök igen senare.
                                          </app-callout>
                                        } @else if (subStatus() === 'loading') {
                                          <div aria-busy="true" class="py-2">
                                            <app-skeleton [count]="2" />
                                          </div>
                                        } @else {
                                          <div class="expand-in mt-2 mb-3">
                                            <app-transaction-list
                                              [transactions]="subTransactions()"
                                              [compact]="true"
                                              [showOwnShare]="view() === 'mine'"
                                            />
                                          </div>
                                        }
                                      }
                                    </li>
                                  }
                                  <li class="px-2 py-2 text-sm">
                                    <a
                                      data-category-link
                                      routerLink="/transaktioner"
                                      [queryParams]="monthParams({ categories: '' + bar.item.id })"
                                      class="font-semibold text-accent"
                                      >Visa transaktionerna →</a
                                    >
                                  </li>
                                </ul>
                              }
                            </li>
                          }
                        </ul>
                      </div>
                    }
                  </section>
                }

                @if (o.uncategorised > 0) {
                  <a
                    data-uncategorised-row
                    routerLink="/granska"
                    class="tx-row flex items-center justify-between gap-3 rounded-[14px] border border-dashed border-line-strong px-4 py-3 text-sm"
                  >
                    <span
                      >{{ o.uncategorised }}
                      {{
                        o.uncategorised === 1
                          ? 'okategoriserad transaktion'
                          : 'okategoriserade transaktioner'
                      }}</span
                    >
                    <span class="font-semibold whitespace-nowrap text-accent">Granska →</span>
                  </a>
                }
              </div>

              @if (accountRows(); as rows) {
                <section data-accounts class="card p-4 sm:p-5">
                  <div class="mb-3 flex items-center justify-between">
                    <h2 class="card-title">Konton</h2>
                    <a routerLink="/banker" class="text-sm font-semibold text-accent">Banker →</a>
                  </div>
                  <ul class="flex flex-col gap-1">
                    @for (row of rows; track row.account.id) {
                      <li class="flex items-center gap-3 py-2">
                        <span
                          data-monogram
                          class="grid size-9 shrink-0 place-content-center rounded-[10px] bg-surface-3 text-sm font-bold"
                          aria-hidden="true"
                          >{{ row.bank.charAt(0).toUpperCase() }}</span
                        >
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span data-account-name class="truncate text-[15px] font-medium">{{
                            row.account.name
                          }}</span>
                          <span data-account-detail class="truncate text-xs text-muted"
                            >{{ row.bank }} · {{ accountType(row.account) }}</span
                          >
                        </span>
                        <span data-balance class="amount shrink-0 text-[15px]">{{
                          row.account.balance
                            ? (row.account.balance.amount | money: row.account.balance.currency)
                            : '–'
                        }}</span>
                      </li>
                    }
                  </ul>
                </section>
              }
            </div>
          }
        }
      }
    </app-page>
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

  /** Fetched once; the card is a convenience, so a failure just leaves it out. */
  private readonly settlement = toSignal(
    inject(SettlementService)
      .get()
      .pipe(catchError(() => of(undefined))),
    { initialValue: undefined },
  );

  /** Each open account with its bank. */
  protected readonly accountRows = computed<AccountRow[] | null>(() => {
    const open =
      this.accounts()?.banks.flatMap((group) =>
        group.accounts.filter((a) => !a.hidden).map((account) => ({ account, bank: group.bank })),
      ) ?? [];
    return open.length === 0 ? null : open;
  });

  /** What the amber banner says about the first connection that is expiring or expired. */
  protected readonly banner = computed<string | null>(() => {
    const lapsed = this.accounts()?.banks.filter((g) => g.status !== 'active') ?? [];
    const group = lapsed.find((g) => g.status === 'expired') ?? lapsed[0];
    if (!group) return null;
    if (group.status === 'expired') return `Kopplingen till ${group.bank} har gått ut.`;
    const days = Math.max(1, Math.ceil((Date.parse(group.validUntil) - Date.now()) / DAY_MS));
    return `Kopplingen till ${group.bank} går ut om ${days === 1 ? '1 dag' : `${days} dagar`}.`;
  });

  private readonly currentMonth = monthOf(new Date());
  protected readonly month = signal(this.currentMonth);
  protected readonly views = VIEWS;
  /** Min andel by default; remembered per device. */
  protected readonly view = signal<OverviewView>(storedView());
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

  protected readonly spendingBars = computed(() =>
    bars(this.spending(), this.overview()?.totals.spending ?? 0),
  );

  /** Spending so far this month against the month before, accumulated day by day. */
  protected readonly chart = computed<SpendingChart | null>(() => {
    const o = this.overview();
    if (o === null) return null;
    const { current, previous } = o.spendingByDay;
    if ((current.at(-1) ?? 0) <= 0 && (previous.at(-1) ?? 0) <= 0) return null;

    const isCurrentMonth = o.month === this.currentMonth;
    const days = isCurrentMonth ? Math.min(new Date().getDate(), current.length) : current.length;
    const shown = current.slice(0, days);
    const last = Math.max(current.length, previous.length) - 1;
    const top = Math.max(...shown, ...previous, 1);
    // A refund can take the running total below zero; the scale then reaches down to it.
    const bottom = Math.min(...shown, ...previous, 0);
    const x = (day: number) => (day / last) * CHART_WIDTH;
    const y = (value: number) => CHART_HEIGHT - ((value - bottom) / (top - bottom)) * CHART_HEIGHT;
    // A single point (the 1st of the month) is doubled so the round line cap draws a dot.
    const line = (values: number[]) =>
      (values.length === 1 ? [...values, ...values] : values)
        .map((value, day) => `${x(day).toFixed(1)},${y(value).toFixed(1)}`)
        .join(' ');

    const spent = shown.at(-1) ?? 0;
    const before = previous[Math.min(days, previous.length) - 1] ?? 0;
    const diff = Math.round((spent - before) * 100) / 100;
    const compared = isCurrentMonth ? 'vid samma tidpunkt förra månaden' : 'förra månaden';
    const against =
      diff === 0
        ? `lika mycket som ${compared}`
        : `${money.transform(Math.abs(diff))} ${diff > 0 ? 'mer' : 'mindre'} än ${compared}`;
    const pctOf = (value: number) => ((value - bottom) / (top - bottom)) * 100;
    const yTicks = [bottom, (bottom + top) / 2, top].map((value) => ({
      label: `${KR.format(Math.round(value))} kr`,
      pct: pctOf(value),
    }));
    const xTicks = [...new Set([1, 8, 15, 22, last + 1])].map((day) => ({
      label: String(day),
      pct: (last === 0 ? 0 : (day - 1) / last) * 100,
    }));
    return {
      current: line(shown),
      previous: line(previous),
      currentDays: shown,
      previousDays: previous,
      length: last + 1,
      top,
      bottom,
      yTicks,
      xTicks,
      summary: `${isCurrentMonth ? 'Hittills' : 'Totalt'} ${money.transform(spent)}, ${against} (${money.transform(before)}).`,
    };
  });

  /** The day the pointer is on in the chart, 1-based. */
  protected readonly hoveredDay = signal<number | null>(null);

  /** What the tooltip says about the hovered day: each month's date and amount so far. */
  protected readonly tip = computed<ChartTip | null>(() => {
    const c = this.chart();
    const day = this.hoveredDay();
    if (c === null || day === null) return null;
    const [year, number] = this.month().split('-').map(Number) as [number, number];
    const at = (days: number[], monthIndex: number) => {
      const amount = days[day - 1];
      if (amount === undefined) return undefined;
      return {
        date: DAY_LONG.format(new Date(year, monthIndex, day)),
        amount: money.transform(amount),
        top: 100 - ((amount - c.bottom) / (c.top - c.bottom)) * 100,
      };
    };
    return {
      pct: c.length > 1 ? ((day - 1) / (c.length - 1)) * 100 : 0,
      current: at(c.currentDays, number - 1),
      previous: at(c.previousDays, number - 2),
    };
  });

  /**
   * Follows a finger across the chart. A touch pointer is captured by the element it
   * landed on, so the per-day columns never see it enter; map its x position to a day instead.
   */
  protected touchDay(event: PointerEvent): void {
    const length = this.chart()?.length ?? 0;
    if (event.pointerType !== 'touch' || length < 1) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    this.hoveredDay.set(Math.round(ratio * (length - 1)) + 1);
  }

  /** One hover column per day of the chart. */
  protected readonly chartDays = computed(() =>
    Array.from({ length: this.chart()?.length ?? 0 }, (_, i) => i + 1),
  );

  /** One ring segment per spending category, in the category's colour. */
  protected readonly donut = computed<DonutSegment[]>(() => {
    const items = this.spending().filter((c) => c.total > 0);
    const sum = items.reduce((acc, c) => acc + c.total, 0);
    let used = 0;
    return items.map((c) => {
      const length = (c.total / sum) * CIRCUMFERENCE;
      const visible = Math.max(length - (items.length > 1 ? SEGMENT_GAP : 0), 0.5);
      const segment = {
        id: c.id,
        name: c.name,
        colour: CATEGORY_PALETTE[c.colour].colour,
        dash: `${visible} ${CIRCUMFERENCE - visible}`,
        offset: -used,
      };
      used += length;
      return segment;
    });
  });

  /** Transaktioner pre-filtered to the month shown, and whatever else `extra` adds. */
  protected monthParams(extra: Record<string, string>): Record<string, string> {
    const [year, number] = this.month().split('-').map(Number) as [number, number];
    return {
      from: dayOf(new Date(year, number - 1, 1)),
      to: dayOf(new Date(year, number, 0)),
      ...extra,
    };
  }

  /** Netto, Inkomster, Utgifter, Sparande and, with a balance setting, Avräkning. */
  protected readonly tiles = computed<Tile[]>(() => {
    const o = this.overview();
    if (o === null) return [];
    const tiles: Tile[] = TOTALS.map(({ kind, label }) => ({
      kind,
      label,
      amount: money.transform(o.totals[kind]),
      line: this.changeText(o.totals[kind] - o.previous[kind]),
      positive: kind === 'net' && o.totals.net >= 0,
      link:
        kind === 'net'
          ? undefined
          : {
              path: '/transaktioner',
              params: this.monthParams({ kind: kind === 'income' ? 'in' : 'out' }),
            },
    }));
    tiles.push({
      kind: 'savings',
      label: 'Sparande',
      amount: money.transform(o.savings.current),
      line: this.changeText(o.savings.current - o.savings.previous),
      positive: false,
      link:
        o.savings.subcategoryId === null
          ? undefined
          : {
              path: '/transaktioner',
              params: this.monthParams({ subcategories: '' + o.savings.subcategoryId }),
            },
    });
    const settlement = this.settlementTile(o.month);
    if (settlement !== null) tiles.push(settlement);
    return tiles;
  });

  /**
   * Avräkning for the month shown, from the settlement period named for it (ADR 0014):
   * what a closed period paid, or the live balance of the open one.
   */
  private settlementTile(month: string): Tile | null {
    const settlement = this.settlement();
    if (settlement === undefined) return null;
    const open = settlement.periods.find((p) => p.closedThrough === null);
    const base = { kind: 'settlement' as const, label: 'Avräkning', positive: false };

    const closed = settlement.periods.find((p) => p.month === month && p.closedThrough !== null);
    if (closed?.closedThrough) {
      const lines = [`Avslutad t.o.m. ${shortDay(closed.closedThrough)}`];
      if (closed.carriedOut !== 0) lines.push(`${KR.format(Math.abs(closed.carriedOut))} kr kvar`);
      return {
        ...base,
        amount: money.transform(closed.paid),
        line: lines.join(' · '),
        link: { path: '/delat', params: { manad: month } },
      };
    }

    const balance = settlement.balance;
    if (open === undefined || balance === null) return null;
    const earlierOpen = month === this.currentMonth && open.month < month;
    if (open.month !== month && !earlierOpen) return null;
    const lines = [
      balance === 0
        ? 'Ni är kvitt'
        : balance > 0
          ? 'Partnern är skyldig dig'
          : 'Du är skyldig partnern',
    ];
    if (open.overdue) lines.push(`${monthName(open.month)} är inte avslutad`);
    return {
      ...base,
      amount: money.transform(Math.abs(balance)),
      line: lines.join(' · '),
      link: { path: '/delat', params: { manad: open.month } },
    };
  }

  protected accountType(account: ConnectedAccount): string {
    return account.savings ? ACCOUNT_TYPES.savings : ACCOUNT_TYPES[account.type];
  }

  constructor() {
    this.load();
  }

  /** A category's subcategories as bars, sharing out the category's own total. */
  protected subBars(category: OverviewCategory) {
    return bars(category.subcategories, category.total);
  }

  protected setView(view: OverviewView): void {
    if (view === this.view()) return;
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Not remembered, but the choice still applies to this visit.
    }
    this.load();
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
    this.hoveredDay.set(null);
    this.status.set('loading');
    this.overviewRequest = this.service.get(this.month(), this.view()).subscribe({
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
