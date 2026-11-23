import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { CATEGORY_PALETTE, type SavingsResponse } from '@bankapp/shared';
import { ManualSavingsSection } from '../../manual-savings/manual-savings-section';
import { APP_LOCALE } from '../../formatting/locale';
import { MoneyPipe } from '../../formatting/money.pipe';
import { SavingsService } from '../../savings.service';
import { Page } from '../../page/page';

/** The chart's drawing area, in the SVG's own units. */
const CHART_WIDTH = 300;
const CHART_HEIGHT = 120;

/** One colour per account, in the order of the account list; all read on the dark background. */
const SERIES_COLOURS = [
  CATEGORY_PALETTE.violet.colour,
  CATEGORY_PALETTE.sky.colour,
  CATEGORY_PALETTE.emerald.colour,
  CATEGORY_PALETTE.amber.colour,
  CATEGORY_PALETTE.pink.colour,
  CATEGORY_PALETTE.teal.colour,
  CATEGORY_PALETTE.orange.colour,
  CATEGORY_PALETTE.indigo.colour,
];

const money = new MoneyPipe();
const KR = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 0 });
const MONTH_SHORT = new Intl.DateTimeFormat(APP_LOCALE, { month: 'short', year: '2-digit' });
const MONTH_LONG = new Intl.DateTimeFormat(APP_LOCALE, { month: 'long', year: 'numeric' });
const MONTH_NAME = new Intl.DateTimeFormat(APP_LOCALE, { month: 'long' });

type Range = 'year' | 'all';
const ALL = 'all';

const monthDate = (month: string) => {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Date(year, number - 1, 1);
};

interface Layer {
  key: string;
  name: string;
  colour: string;
  /** The polygon's `x,y` pairs. */
  points: string;
}

interface Chart {
  layers: Layer[];
  /** The net deposits line; empty when no shown month has net deposits. */
  deposits: string;
  months: string[];
  /** Each month's top of the stack and net deposits, as a percentage from the top. */
  tops: number[];
  depositTops: (number | null)[];
  yTicks: { label: string; pct: number }[];
  xTicks: { label: string; pct: number }[];
}

interface Tip {
  pct: number;
  title: string;
  rows: { name: string; colour: string; amount: string }[];
  total: string;
  deposits: string | null;
  growth: string | null;
  top: number;
  depositTop: number | null;
}

/** Sparande: the savings accounts, connected and manual, and how they change over time. */
@Component({
  selector: 'app-sparande-page',
  imports: [Page, ManualSavingsSection, MoneyPipe, NgTemplateOutlet],
  template: `
    <app-page title="Sparande">
      @if (failed()) {
        <p role="alert" class="text-danger">Sparandet kunde inte hämtas. Försök igen senare.</p>
      }

      @for (reminder of data()?.reminders ?? []; track reminder.key) {
        <p
          data-reminder
          class="rounded-[10px] border border-line-strong bg-surface-2 px-4 py-3 text-sm text-warning"
        >
          {{ reminder.name }} är inte uppdaterat i {{ monthName(reminder.month) }}
        </p>
      }

      @if (data(); as d) {
        <section
          data-totals
          class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3"
        >
          <div class="card min-w-0 p-4">
            <div class="text-[11px] tracking-wider text-muted uppercase">Saldo</div>
            <div data-total-balance class="amount text-lg break-words sm:text-xl">
              {{ d.totals.balance | money }}
            </div>
          </div>
          <div class="card min-w-0 p-4">
            <div class="text-[11px] tracking-wider text-muted uppercase">Insatt</div>
            <div data-total-deposits class="amount text-lg break-words sm:text-xl">
              @if (d.totals.netDeposits !== null) {
                {{ approx(d.totals.approximate) }}{{ d.totals.netDeposits | money }}
              } @else {
                –
              }
            </div>
          </div>
          <div class="card min-w-0 p-4">
            <div class="text-[11px] tracking-wider text-muted uppercase">Utveckling</div>
            <div data-total-growth class="amount text-lg break-words sm:text-xl">
              @if (d.totals.growth !== null) {
                {{ approx(d.totals.approximate) }}{{ d.totals.growth | money }}
                @if (d.totals.growthPercent !== null) {
                  <span class="block text-sm text-muted"
                    >({{ approx(d.totals.approximate) }}{{ percent(d.totals.growthPercent) }})</span
                  >
                }
              } @else {
                –
              }
            </div>
          </div>
        </section>

        @if (d.months.length > 0) {
          <section data-chart-section class="card p-4 sm:p-5">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 class="text-lg font-semibold">Saldo över tid</h2>
              <div class="flex flex-wrap gap-2">
                <select
                  data-account-select
                  class="input"
                  aria-label="Konto"
                  [value]="selected()"
                  (change)="select($event)"
                >
                  <option value="all">Alla konton</option>
                  @for (account of d.accounts; track account.key) {
                    <option [value]="account.key" [selected]="selected() === account.key">
                      {{ label(account) }}
                    </option>
                  }
                </select>
                <div class="flex gap-1" role="group" aria-label="Period">
                  <button
                    type="button"
                    data-range="year"
                    class="btn btn-sm"
                    [class.btn-primary]="range() === 'year'"
                    [class.btn-secondary]="range() !== 'year'"
                    [attr.aria-pressed]="range() === 'year'"
                    (click)="range.set('year')"
                  >
                    1 år
                  </button>
                  <button
                    type="button"
                    data-range="all"
                    class="btn btn-sm"
                    [class.btn-primary]="range() === 'all'"
                    [class.btn-secondary]="range() !== 'all'"
                    [attr.aria-pressed]="range() === 'all'"
                    (click)="range.set('all')"
                  >
                    Allt
                  </button>
                </div>
              </div>
            </div>

            @if (chart(); as c) {
              <div class="flex gap-2">
                <div class="relative h-44 w-16 shrink-0" aria-hidden="true">
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
                    class="relative h-44 touch-pan-y"
                    (pointerleave)="hovered.set(null)"
                    (pointerdown)="touch($event)"
                    (pointermove)="touch($event)"
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
                      @for (layer of c.layers; track layer.key) {
                        <polygon
                          [attr.data-area]="layer.key"
                          [attr.points]="layer.points"
                          [attr.fill]="layer.colour"
                          fill-opacity="0.55"
                          [attr.stroke]="layer.colour"
                          stroke-width="1.5"
                          vector-effect="non-scaling-stroke"
                        />
                      }
                      @if (c.deposits) {
                        <polyline
                          data-line="deposits"
                          [attr.points]="c.deposits"
                          fill="none"
                          stroke="var(--color-ink)"
                          stroke-width="2.5"
                          stroke-dasharray="5 4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          vector-effect="non-scaling-stroke"
                        />
                      }
                    </svg>

                    @if (tip(); as t) {
                      <div
                        class="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
                        [style.left.%]="t.pct"
                      ></div>
                      <span
                        class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
                        [style.left.%]="t.pct"
                        [style.top.%]="t.top"
                      ></span>
                      @if (t.depositTop !== null) {
                        <span
                          class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
                          [style.left.%]="t.pct"
                          [style.top.%]="t.depositTop"
                        ></span>
                      }
                      <div
                        data-chart-tooltip
                        class="pointer-events-none absolute top-0 z-10 flex flex-col gap-1 rounded-[10px] border border-line-strong bg-surface-3 px-3 py-2 text-xs whitespace-nowrap shadow-lg"
                        [style.left.%]="t.pct"
                        [style.transform]="'translateX(-' + t.pct + '%)'"
                      >
                        <span class="font-semibold capitalize">{{ t.title }}</span>
                        @for (row of t.rows; track row.name) {
                          <span class="flex items-center gap-2"
                            ><span
                              class="size-2 rounded-full"
                              [style.background]="row.colour"
                            ></span
                            >{{ row.name }}
                            <span class="amount ml-auto">{{ row.amount }}</span></span
                          >
                        }
                        <span class="flex items-center gap-2 border-t border-line pt-1"
                          >Totalt <span class="amount ml-auto">{{ t.total }}</span></span
                        >
                        @if (t.deposits !== null) {
                          <span class="flex items-center gap-2"
                            >Insatt <span class="amount ml-auto">{{ t.deposits }}</span></span
                          >
                        }
                        @if (t.growth !== null) {
                          <span class="flex items-center gap-2"
                            >Utveckling i månaden
                            <span class="amount ml-auto">{{ t.growth }}</span></span
                          >
                        }
                      </div>
                    }

                    @for (month of c.months; track month; let i = $index) {
                      <div
                        class="absolute inset-y-0"
                        [attr.data-chart-month]="month"
                        [style.left.%]="columnLeft(i, c.months.length)"
                        [style.width.%]="columnWidth(c.months.length)"
                        (pointerenter)="hovered.set(i)"
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
              <p data-legend class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                @for (layer of c.layers; track layer.key) {
                  <span class="flex items-center gap-1.5"
                    ><span class="size-2.5 rounded-sm" [style.background]="layer.colour"></span
                    >{{ layer.name }}</span
                  >
                }
                @if (c.deposits) {
                  <span class="flex items-center gap-1.5"
                    ><span class="h-0.5 w-4 rounded border-t-2 border-dashed border-ink"></span
                    >Insatt</span
                  >
                }
              </p>
            }
          </section>
        }

        <section data-accounts class="card flex flex-col gap-4 p-4 sm:p-5">
          <h2 class="text-lg font-semibold">Konton</h2>
          @if (open().length === 0) {
            <p class="text-sm text-muted">
              Inga sparkonton ännu. Markera ett konto som sparkonto på Banker, eller lägg till ett
              manuellt sparkonto nedan.
            </p>
          }
          <ul class="flex flex-col divide-y divide-line">
            @for (account of open(); track account.key) {
              <li
                data-account-row
                [attr.data-key]="account.key"
                class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
              >
                <ng-container
                  *ngTemplateOutlet="row; context: { $implicit: account }"
                ></ng-container>
              </li>
            }
          </ul>
          @if (closed().length > 0) {
            <details data-closed-accounts>
              <summary class="cursor-pointer text-sm text-muted">
                Avslutade ({{ closed().length }})
              </summary>
              <ul class="mt-3 flex flex-col divide-y divide-line">
                @for (account of closed(); track account.key) {
                  <li
                    data-account-row
                    [attr.data-key]="account.key"
                    class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
                  >
                    <ng-container
                      *ngTemplateOutlet="row; context: { $implicit: account }"
                    ></ng-container>
                  </li>
                }
              </ul>
            </details>
          }
        </section>
      }

      <app-manual-savings-section (changed)="load()" />
    </app-page>

    <ng-template #row let-account>
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span class="min-w-0 font-medium break-words" data-account-name>{{ label(account) }}</span>
        <span class="amount text-lg" data-account-balance>{{ account.balance ?? 0 | money }}</span>
      </div>
      <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        @if (account.netDeposits !== null) {
          <div data-account-deposits>
            <dt class="text-[11px] tracking-wider text-muted uppercase">Insatt</dt>
            <dd class="amount">
              {{ approx(account.approximate) }}{{ account.netDeposits | money }}
            </dd>
          </div>
        }
        @if (account.growth !== null) {
          <div data-account-growth>
            <dt class="text-[11px] tracking-wider text-muted uppercase">Utveckling</dt>
            <dd class="amount">
              {{ approx(account.approximate) }}{{ account.growth | money }}
              @if (account.growthPercent !== null) {
                <span class="text-muted">({{ percent(account.growthPercent) }})</span>
              }
            </dd>
          </div>
        }
        @if (account.closedOn) {
          <div>
            <dt class="text-[11px] tracking-wider text-muted uppercase">Avslutat</dt>
            <dd>{{ account.closedOn }}</dd>
          </div>
        }
        <div data-account-updated>
          <dt class="text-[11px] tracking-wider text-muted uppercase">Senast uppdaterad</dt>
          <dd>{{ account.lastUpdated ?? 'aldrig' }}</dd>
        </div>
      </dl>
    </ng-template>
  `,
})
export class SparandePage {
  private readonly service = inject(SavingsService);

  protected readonly data = signal<SavingsResponse | null>(null);
  protected readonly failed = signal(false);
  protected readonly selected = signal<string>(ALL);
  protected readonly range = signal<Range>('year');
  protected readonly hovered = signal<number | null>(null);

  protected readonly open = computed(() =>
    (this.data()?.accounts ?? []).filter((account) => account.closedOn === null),
  );
  protected readonly closed = computed(() =>
    (this.data()?.accounts ?? []).filter((account) => account.closedOn !== null),
  );

  constructor() {
    this.load();
  }

  protected load(): void {
    this.service.get().subscribe({
      next: (data) => {
        this.failed.set(false);
        this.data.set(data);
      },
      error: () => this.failed.set(true),
    });
  }

  protected select(event: Event): void {
    this.selected.set((event.target as HTMLSelectElement).value);
    this.hovered.set(null);
  }

  /** The account's name with its bank or broker after it, when it has one. */
  protected label(account: { name: string; institution: string | null }): string {
    return account.institution ? `${account.name} (${account.institution})` : account.name;
  }

  protected approx(approximate: boolean): string {
    return approximate ? '≈ ' : '';
  }

  protected percent(value: number): string {
    return `${new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 1 }).format(value)} %`;
  }

  protected monthName(month: string): string {
    return MONTH_NAME.format(monthDate(month));
  }

  /** The months on the chart: the last twelve, or all of them. */
  private readonly shownMonths = computed(() => {
    const months = this.data()?.months ?? [];
    return this.range() === 'year' ? months.slice(-12) : months;
  });

  /** The accounts drawn, each with the colour it has in the account list. */
  private readonly series = computed(() => {
    const accounts = this.data()?.accounts ?? [];
    const coloured = accounts.map((account, i) => ({
      account,
      colour: SERIES_COLOURS[i % SERIES_COLOURS.length]!,
    }));
    const selected = this.selected();
    const wanted = selected === ALL ? coloured : coloured.filter((c) => c.account.key === selected);
    const present = new Set(
      this.shownMonths().flatMap((month) => month.accounts.map((account) => account.key)),
    );
    return wanted.filter((entry) => present.has(entry.account.key));
  });

  /** What each shown month holds: per drawn account its balance, and the net deposits line. */
  private readonly figures = computed(() => {
    const keys = this.series().map((entry) => entry.account.key);
    const selected = this.selected();
    return this.shownMonths().map((month) => {
      const byKey = new Map(month.accounts.map((account) => [account.key, account]));
      const balances = keys.map((key) => byKey.get(key)?.balance ?? 0);
      const total = balances.reduce((sum, value) => sum + value, 0);
      const single = selected === ALL ? null : byKey.get(selected);
      return {
        month: month.month,
        balances,
        total,
        netDeposits: selected === ALL ? month.netDeposits : (single?.netDeposits ?? null),
        growth: selected === ALL ? month.growth : (single?.growth ?? null),
      };
    });
  });

  protected readonly chart = computed<Chart | null>(() => {
    const series = this.series();
    const figures = this.figures();
    if (series.length === 0 || figures.length === 0) return null;

    const tops = figures.map((f) => f.total);
    const deposits = figures.map((f) => f.netDeposits);
    const top = Math.max(...tops, ...deposits.map((d) => d ?? 0), 1);
    const bottom = Math.min(0, ...deposits.map((d) => d ?? 0), ...tops);
    const span = top - bottom;
    // A single month is drawn as a flat stretch so its area still shows.
    const last = Math.max(figures.length - 1, 1);
    const x = (i: number) => (i / last) * CHART_WIDTH;
    const y = (value: number) => CHART_HEIGHT - ((value - bottom) / span) * CHART_HEIGHT;
    const pad = <T>(values: T[]): T[] => (values.length === 1 ? [...values, ...values] : values);
    const pair = (values: number[]) =>
      pad(values).map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`);

    const cumulative = figures.map((f) => {
      let sum = 0;
      return f.balances.map((value) => (sum += value));
    });
    const layers = series.map((entry, index): Layer => {
      const upper = cumulative.map((sums) => sums[index]!);
      const lower = cumulative.map((sums) => (index === 0 ? 0 : sums[index - 1]!));
      return {
        key: entry.account.key,
        name: this.label(entry.account),
        colour: entry.colour,
        points: [...pair(upper), ...pair(lower).reverse()].join(' '),
      };
    });
    const withDeposits = deposits.flatMap((value, i) => (value === null ? [] : [{ value, i }]));
    const depositLine = pad(withDeposits)
      .map(({ value, i }, k) => {
        const at = withDeposits.length === 1 ? (k === 0 ? 0 : last) : i;
        return `${x(at).toFixed(1)},${y(value).toFixed(1)}`;
      })
      .join(' ');

    const pctOf = (value: number) => ((value - bottom) / span) * 100;
    const yTicks = [bottom, (bottom + top) / 2, top].map((value) => ({
      label: `${KR.format(Math.round(value))} kr`,
      pct: pctOf(value),
    }));
    const wantedTicks = Math.min(figures.length, 4);
    const tickIndexes = [
      ...new Set(
        Array.from({ length: wantedTicks }, (_, k) =>
          Math.round((k * (figures.length - 1)) / Math.max(wantedTicks - 1, 1)),
        ),
      ),
    ];
    return {
      layers,
      deposits: withDeposits.length > 0 ? depositLine : '',
      months: figures.map((f) => f.month),
      tops: tops.map((value) => 100 - pctOf(value)),
      depositTops: deposits.map((value) => (value === null ? null : 100 - pctOf(value))),
      yTicks,
      xTicks: tickIndexes.map((i) => ({
        label: MONTH_SHORT.format(monthDate(figures[i]!.month)),
        pct: figures.length === 1 ? 0 : (i / (figures.length - 1)) * 100,
      })),
    };
  });

  protected readonly tip = computed<Tip | null>(() => {
    const c = this.chart();
    const i = this.hovered();
    const f = i === null ? undefined : this.figures()[i];
    if (c === null || i === null || f === undefined) return null;
    const series = this.series();
    const count = c.months.length;
    return {
      pct: count > 1 ? (i / (count - 1)) * 100 : 0,
      title: MONTH_LONG.format(monthDate(f.month)),
      rows:
        this.selected() === ALL
          ? series.map((entry, k) => ({
              name: this.label(entry.account),
              colour: entry.colour,
              amount: money.transform(f.balances[k]!),
            }))
          : [],
      total: money.transform(f.total),
      deposits: f.netDeposits === null ? null : money.transform(f.netDeposits),
      growth: f.growth === null ? null : money.transform(f.growth),
      top: c.tops[i]!,
      depositTop: c.depositTops[i] ?? null,
    };
  });

  /** One hover column per month, centred on its point. */
  protected columnLeft(index: number, count: number): number {
    return count > 1 ? ((index - 0.5) / (count - 1)) * 100 : 0;
  }

  protected columnWidth(count: number): number {
    return count > 1 ? 100 / (count - 1) : 100;
  }

  /** Follows a finger across the chart; a touch pointer never "enters" the month columns. */
  protected touch(event: PointerEvent): void {
    const count = this.chart()?.months.length ?? 0;
    if (event.pointerType !== 'touch' || count < 1) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
    this.hovered.set(Math.round(ratio * (count - 1)));
  }
}
