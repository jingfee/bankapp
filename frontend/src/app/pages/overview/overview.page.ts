import {
  ChartCard,
  type ChartColumn,
  type ChartLegendItem,
  type ChartTip,
} from '../../chart-card/chart-card';
import { shortDate } from '../../formatting/short-date.pipe';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_PALETTE,
  type AccountType,
  type ConnectedAccount,
  type OverviewCategory,
  type OverviewResponse,
  type OverviewView,
} from '@bankapp/shared';
import { owesText } from '../../balance-display';
import { dayOf, monthOf, shiftMonth } from '../../dates';
import { CategoryBar } from '../../category-bar/category-bar';
import { MoneyPipe } from '../../formatting/money.pipe';
import { APP_LOCALE } from '../../formatting/locale';
import { AccountsStore } from '../../stores/accounts.store';
import { BanksStore } from '../../stores/banks.store';
import { OverviewStore } from '../../stores/overview.store';
import { SettlementStore } from '../../stores/settlement.store';
import { TransactionList } from '../../transaction-list/transaction-list';
import { Callout } from '../../callout/callout';
import { ReadFailed } from '../../offline/not-saved';
import { Empty } from '../../empty/empty';
import { Page } from '../../page/page';
import { Skeleton } from '../../skeleton/skeleton';
import { OfflineDisabled } from '../../offline/offline-disabled';

interface Bar<T> {
  item: T;
  /** Share of the section's total, as a whole percentage. */
  share: number;
  /** Width relative to the largest bar of the group, as a whole percentage. */
  width: number;
}

const ACCOUNT_TYPES: Record<AccountType, string> = {
  payment: 'Betalkonto',
  savings: 'Sparkonto',
  card: 'Kortkonto',
};

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

const KR = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 0 });

interface TotalLink {
  path: string;
  params: Record<string, string>;
  amount: string;
  change: string;
}

/** The bar in the Netto card: a track with a grey part and a coloured remainder. */
interface NetBar {
  /** How much of the track the grey part fills, as a whole percentage. */
  fill: number;
  /** Colour of what remains: Netto in green, overspending in red, or nothing in a current month. */
  rest: 'positive' | 'danger' | 'none';
  /** The caption, split so that the figure can be bold. */
  caption: { before: string; strong: string; after: string };
}

interface NetCard {
  amount: string;
  change: string;
  tone: 'positive' | 'negative' | 'neutral';
  ongoing: boolean;
  bar: NetBar | null;
  income: TotalLink;
  spending: TotalLink;
  savings: TotalLink | null;
}

interface SettlementRow {
  closed: boolean;
  amount: string;
  lines: string[];
  link: { path: string; params: Record<string, string> };
}

interface AccountRow {
  account: ConnectedAccount;
  bank: string;
}

const money = new MoneyPipe();

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
<<<<<<< HEAD
=======
    ReadFailed,
>>>>>>> f57ddef
    OfflineDisabled,
    ChartCard,
    Page,
    RouterLink,
    MoneyPipe,
    CategoryBar,
    TransactionList,
    Callout,
    Empty,
    Skeleton,
  ],
  template: `
    <app-page [fetchedAt]="fetchedAt()">
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
            <app-skeleton shape="summary" />
            <app-skeleton shape="card" />
          </div>
        }
        @case ('failed') {
          <app-read-failed>Översikten kunde inte hämtas. Försök igen senare.</app-read-failed>
        }
        @default {
          @if (overview(); as o) {
            @if (netCard(); as n) {
              <div
                data-summary
                class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:gap-2.5"
                [class.lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]]="settlementRow()"
              >
                <section
                  data-total="net"
                  aria-label="Netto"
                  class="net-card"
                  [class.net-card-positive]="n.tone === 'positive'"
                  [class.net-card-negative]="n.tone === 'negative'"
                >
                  <div class="net-card-head">
                    <span class="flex items-center gap-2">
                      <span class="eyebrow">Netto</span>
                      @if (n.ongoing) {
                        <span data-ongoing class="net-pill">Pågår</span>
                      }
                    </span>
                    <span
                      data-amount
                      class="amount text-[32px] leading-tight whitespace-nowrap"
                      [class.text-positive]="n.tone === 'positive'"
                      [class.text-danger]="n.tone === 'negative'"
                      >{{ n.amount }}</span
                    >
                    <span data-change class="text-xs leading-snug text-muted">{{ n.change }}</span>
                  </div>

                  <div class="net-card-body">
                    @if (n.bar; as bar) {
                      <div class="flex flex-col gap-1.5">
                        <div
                          data-net-bar
                          role="img"
                          class="net-bar"
                          [attr.aria-label]="
                            bar.caption.before + bar.caption.strong + bar.caption.after
                          "
                        >
                          <span
                            data-bar-spending
                            class="net-bar-fill"
                            [class.net-bar-fill-accent]="bar.rest === 'none'"
                            [style.width.%]="bar.fill"
                          ></span>
                          @if (bar.rest !== 'none') {
                            <span
                              class="net-bar-rest"
                              [class.net-bar-rest-danger]="bar.rest === 'danger'"
                              [style.left.%]="bar.fill"
                            ></span>
                          }
                        </div>
                        <p
                          data-net-caption
                          class="text-xs leading-snug text-muted"
                          aria-hidden="true"
                        >
                          {{ bar.caption.before
                          }}<strong class="font-semibold text-ink">{{ bar.caption.strong }}</strong
                          >{{ bar.caption.after }}
                        </p>
                      </div>
                    }

                    <div class="grid grid-cols-2 gap-2">
                      <a
                        data-total="income"
                        data-total-link
                        [routerLink]="n.income.path"
                        [queryParams]="n.income.params"
                        class="net-box"
                      >
                        <span class="flex items-center justify-between">
                          <span class="eyebrow">In</span><span aria-hidden="true">›</span>
                        </span>
                        <span data-amount class="amount text-[17px] whitespace-nowrap">{{
                          n.income.amount
                        }}</span>
                        <span data-change class="text-xs leading-snug text-muted">{{
                          n.income.change
                        }}</span>
                      </a>
                      <a
                        data-total="spending"
                        data-total-link
                        [routerLink]="n.spending.path"
                        [queryParams]="n.spending.params"
                        class="net-box"
                      >
                        <span class="flex items-center justify-between">
                          <span class="eyebrow">Ut</span><span aria-hidden="true">›</span>
                        </span>
                        <span data-amount class="amount text-[17px] whitespace-nowrap">{{
                          n.spending.amount
                        }}</span>
                        <span data-change class="text-xs leading-snug text-muted">{{
                          n.spending.change
                        }}</span>
                      </a>
                    </div>
                  </div>

                  @if (n.savings; as savings) {
                    <a
                      data-total="savings"
                      data-total-link
                      [routerLink]="savings.path"
                      [queryParams]="savings.params"
                      class="net-savings"
                    >
                      <span class="text-sm">Varav sparande</span>
                      <span class="flex items-center gap-2">
                        <span data-amount class="amount text-[15px] whitespace-nowrap">{{
                          savings.amount
                        }}</span>
                        <span aria-hidden="true">›</span>
                      </span>
                    </a>
                  }
                </section>

                @if (settlementRow(); as s) {
                  <a
                    data-total="settlement"
                    [routerLink]="s.link.path"
                    [queryParams]="s.link.params"
                    class="settlement-row"
                    [class.settlement-row-open]="!s.closed"
                  >
                    <span
                      data-settlement-badge
                      class="settlement-badge"
                      [class.settlement-badge-closed]="s.closed"
                      aria-hidden="true"
                      >{{ s.closed ? '✓' : '⇄' }}</span
                    >
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="eyebrow">Avräkning</span>
                      @for (line of s.lines; track $index) {
                        <span
                          data-change
                          class="text-sm leading-snug break-words"
                          [class.text-muted]="$index > 0 || s.closed"
                          >{{ line }}</span
                        >
                      }
                    </span>
                    <span class="flex shrink-0 items-center gap-2">
                      <span data-amount class="amount text-[17px] whitespace-nowrap">{{
                        s.amount
                      }}</span>
                      <span aria-hidden="true">›</span>
                    </span>
                  </a>
                }
              </div>
            }

            @if (spending().length === 0 && income().length === 0) {
              <app-empty icon="receipt" text="Inga transaktioner den här månaden.">
                @if (!accountRows()) {
                  <a
                    empty-action
                    routerLink="/anslut-bank"
                    appOfflineDisabled
                    class="btn btn-secondary btn-sm"
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
                  <app-chart-card
                    data-spending-chart
                    title="Utgifter jämfört med förra månaden"
                    [summary]="c.summary"
                    [yTicks]="c.yTicks"
                    [xTicks]="c.xTicks"
                    [columns]="chartColumns()"
                    [tip]="tip()"
                    [legend]="legend()"
                    (hovered)="hoverDay($event)"
                  >
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
                  </app-chart-card>
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
                                          <app-read-failed class="my-2">
                                            Transaktionerna kunde inte hämtas. Försök igen senare.
                                          </app-read-failed>
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
  private readonly overviewStore = inject(OverviewStore);
  private readonly banks = inject(BanksStore);
  /** Followed by `BanksStore` from login on; the strip is a convenience, so a failure leaves it out. */
  private readonly accounts = inject(AccountsStore).accounts;

  private readonly settlementStore = inject(SettlementStore);
  /** The card is a convenience, so a failure just leaves it out. */
  private readonly settlement = this.settlementStore.settlement;

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
    const days = this.banks.daysLeft(group.validUntil);
    return `Kopplingen till ${group.bank} går ut om ${days === 1 ? '1 dag' : `${days} dagar`}.`;
  });

  private readonly currentMonth = monthOf(new Date());
  protected readonly month = signal(this.currentMonth);
  protected readonly views = VIEWS;
  /** Min andel by default; remembered per device. */
  protected readonly view = signal<OverviewView>(storedView());
  private readonly overviewRead = this.overviewStore.overview(
    computed(() => ({ month: this.month(), view: this.view() })),
  );
  protected readonly status = computed<'loading' | 'ready' | 'failed'>(() =>
    this.overviewRead.loading() ? 'loading' : this.overviewRead.failed() ? 'failed' : 'ready',
  );
  protected readonly overview = computed<OverviewResponse | null>(
    () => this.overviewRead.value() ?? null,
  );
  protected readonly openCategory = signal<number | null>(null);
  protected readonly openSubcategory = signal<number | null>(null);
  private readonly subRead = this.overviewStore.subcategoryTransactions(
    computed(() => {
      const subcategoryId = this.openSubcategory();
      return subcategoryId === null ? undefined : { month: this.month(), subcategoryId };
    }),
  );
  protected readonly subStatus = computed<'loading' | 'ready' | 'failed'>(() =>
    this.subRead.loading() ? 'loading' : this.subRead.failed() ? 'failed' : 'ready',
  );
  protected readonly subTransactions = computed(() => this.subRead.value()?.transactions ?? []);
  /** When the device fetched what the page shows; the page says so while offline. */
  protected readonly fetchedAt = computed(() => [
    this.overviewRead.fetchedAt(),
    this.subRead.fetchedAt(),
    this.settlementStore.fetchedAt(),
  ]);

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
    const at = (days: number[], monthIndex: number, colour: string) => {
      const amount = days[day - 1];
      if (amount === undefined) return undefined;
      return {
        row: {
          label: shortDate(
            `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          ),
          amount: money.transform(amount),
          colour,
        },
        marker: { top: 100 - ((amount - c.bottom) / (c.top - c.bottom)) * 100, colour },
      };
    };
    const found = [
      at(c.currentDays, number - 1, 'var(--color-accent)'),
      at(c.previousDays, number - 2, 'var(--color-muted)'),
    ].filter((entry) => entry !== undefined);
    return {
      pct: c.length > 1 ? ((day - 1) / (c.length - 1)) * 100 : 0,
      rows: found.map((entry) => entry.row),
      markers: found.map((entry) => entry.marker),
    };
  });

  protected hoverDay(index: number | null): void {
    this.hoveredDay.set(index === null ? null : index + 1);
  }

  /** One hover column per day of the chart, centred on its point. */
  protected readonly chartColumns = computed<ChartColumn[]>(() => {
    const length = this.chart()?.length ?? 0;
    return Array.from({ length }, (_, i) => ({
      key: i + 1,
      left: ((i - 0.5) / (length - 1)) * 100,
      width: 100 / (length - 1),
    }));
  });

  protected readonly legend = computed<ChartLegendItem[]>(() => [
    { label: this.monthTitle(), colour: 'var(--color-accent)', kind: 'line' },
    { label: 'Förra månaden', colour: 'var(--color-muted)', kind: 'dashed' },
  ]);

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

  /** Netto with In, Ut and Varav sparande; the bar says how the month is going. */
  protected readonly netCard = computed<NetCard | null>(() => {
    const o = this.overview();
    if (o === null) return null;
    const ongoing = o.month === this.currentMonth;
    const net = o.totals.net;
    const link = (amount: number, change: number, params: Record<string, string>): TotalLink => ({
      path: '/transaktioner',
      params: this.monthParams(params),
      amount: money.transform(amount),
      change: this.changeText(change),
    });
    return {
      amount: money.transform(net),
      change: ongoing ? 'Hittills den här månaden' : this.changeText(net - o.previous.net),
      tone: net >= 0 ? 'positive' : ongoing ? 'neutral' : 'negative',
      ongoing,
      bar: this.netBar(o, ongoing),
      income: link(o.totals.income, o.totals.income - o.previous.income, { kind: 'in' }),
      spending: link(o.totals.spending, o.totals.spending - o.previous.spending, { kind: 'out' }),
      savings:
        o.savings.subcategoryId === null
          ? null
          : link(o.savings.current, o.savings.current - o.savings.previous, {
              subcategories: '' + o.savings.subcategoryId,
            }),
    };
  });

  /** The month's bar and caption, or null when the income it is measured against is 0. */
  private netBar(o: OverviewResponse, ongoing: boolean): NetBar | null {
    const { income, spending, net } = o.totals;
    const share = (part: number, whole: number) => Math.min(Math.round((part / whole) * 100), 100);
    if (net >= 0) {
      if (income <= 0) return null;
      return {
        fill: share(spending, income),
        rest: 'positive',
        caption: {
          before: 'Du behöll ',
          strong: `${Math.round((net / income) * 100)} %`,
          after: ' av inkomsterna',
        },
      };
    }
    if (ongoing) {
      const basis = o.previous.income;
      if (basis <= 0) return null;
      return {
        fill: share(spending, basis),
        rest: 'none',
        caption: {
          before: 'Du har använt ',
          strong: `${Math.round((spending / basis) * 100)} %`,
          after: ` av förra månadens inkomster (${KR.format(basis)} kr)`,
        },
      };
    }
    return {
      fill: share(income, spending),
      rest: 'danger',
      caption: {
        before: 'Du spenderade ',
        strong: `${KR.format(Math.abs(net))} kr`,
        after: ' mer än du fick in',
      },
    };
  }

  /** Avräkning, when the month shown has a settlement period (ADR 0014). */
  protected readonly settlementRow = computed<SettlementRow | null>(() => {
    const o = this.overview();
    return o === null ? null : this.settlementFor(o.month);
  });

  /** What a closed period paid, or the live balance of the open one. */
  private settlementFor(month: string): SettlementRow | null {
    const settlement = this.settlement();
    if (settlement === undefined) return null;
    const open = settlement.periods.find((p) => p.closedThrough === null);

    const closed = settlement.periods.find((p) => p.month === month && p.closedThrough !== null);
    if (closed?.closedThrough) {
      const lines = [`Avslutad ${shortDate(closed.closedThrough)}`];
      if (closed.carriedOut !== 0) lines.push(`${KR.format(Math.abs(closed.carriedOut))} kr kvar`);
      return {
        closed: true,
        amount: money.transform(closed.paid),
        lines,
        link: { path: '/delat', params: { manad: month } },
      };
    }

    const balance = settlement.balance;
    if (open === undefined || balance === null) return null;
    const earlierOpen = month === this.currentMonth && open.month < month;
    if (open.month !== month && !earlierOpen) return null;
    return {
      closed: false,
      amount: money.transform(Math.abs(balance)),
      lines: [owesText(balance)],
      link: { path: '/delat', params: { manad: open.month } },
    };
  }

  protected accountType(account: ConnectedAccount): string {
    return account.savings ? ACCOUNT_TYPES.savings : ACCOUNT_TYPES[account.type];
  }

  constructor() {
    this.settlementStore.activate();
    inject(DestroyRef).onDestroy(() => this.settlementStore.deactivate());
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
    this.reset();
  }

  protected go(by: number): void {
    const next = shiftMonth(this.month(), by);
    if (next > this.currentMonth) return;
    this.month.set(next);
    this.reset();
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
    this.openSubcategory.set(id);
  }

  private closeSubcategory(): void {
    this.openSubcategory.set(null);
  }

  /** What was open or hovered belongs to the month and view that were showing. */
  private reset(): void {
    this.closeSubcategory();
    this.openCategory.set(null);
    this.hoveredDay.set(null);
  }

  private changeText(change: number): string {
    const rounded = Math.round(change * 100) / 100;
    if (rounded === 0) return 'Oförändrat mot föregående månad';
    return `${rounded > 0 ? '+' : ''}${money.transform(rounded)} mot föregående månad`;
  }
}
