import { ShortDatePipe } from '../../formatting/short-date.pipe';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { CATEGORY_PALETTE, type SavingsResponse } from '@bankapp/shared';
import { ManualSavingsSection } from '../../manual-savings/manual-savings-section';
import { APP_LOCALE } from '../../formatting/locale';
import { MoneyPipe } from '../../formatting/money.pipe';
import { SavingsStore } from '../../stores/savings.store';
import {
  ChartCard,
  type ChartColumn,
  type ChartLegendItem,
  type ChartTip,
} from '../../chart-card/chart-card';
import { monthTicks } from '../../chart-card/month-ticks';
import { Callout } from '../../callout/callout';
import { Disclosure } from '../../disclosure/disclosure';
import { Empty } from '../../empty/empty';
import { Page } from '../../page/page';
import { Skeleton } from '../../skeleton/skeleton';

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

/** Sparande: the savings accounts, connected and manual, and how they change over time. */
@Component({
  selector: 'app-sparande-page',
  imports: [
    ChartCard,
    ShortDatePipe,
    Page,
    ManualSavingsSection,
    MoneyPipe,
    NgTemplateOutlet,
    Callout,
    Disclosure,
    Empty,
    Skeleton,
  ],
  template: `
    <app-page title="Sparande" [fetchedAt]="fetchedAt()">
      @if (failed()) {
        <app-callout variant="danger">Sparandet kunde inte hämtas. Försök igen senare.</app-callout>
      } @else if (!data()) {
        <div aria-busy="true" class="flex flex-col gap-4">
          <app-skeleton shape="tiles" [count]="3" />
          <app-skeleton shape="card" />
        </div>
      }

      @for (reminder of data()?.reminders ?? []; track reminder.key) {
        <app-callout data-reminder variant="warning">
          {{ reminder.name }} är inte uppdaterat i {{ monthName(reminder.month) }}
        </app-callout>
      }

      @if (data(); as d) {
        <section
          data-totals
          class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3"
        >
          <div class="stat-tile">
            <span class="eyebrow">Saldo</span>
            <span data-total-balance class="amount text-[17px] break-words sm:text-[21px]">{{
              d.totals.balance | money
            }}</span>
          </div>
          <div class="stat-tile">
            <span class="eyebrow">Insatt</span>
            <span data-total-deposits class="amount text-[17px] break-words sm:text-[21px]">
              @if (d.totals.netDeposits !== null) {
                {{ approx(d.totals.approximate) }}{{ d.totals.netDeposits | money }}
              } @else {
                –
              }
            </span>
          </div>
          <div class="stat-tile">
            <span class="eyebrow">Utveckling</span>
            <span data-total-growth class="amount text-[17px] break-words sm:text-[21px]">
              @if (d.totals.growth !== null) {
                {{ approx(d.totals.approximate) }}{{ d.totals.growth | money }}
              } @else {
                –
              }
            </span>
            @if (d.totals.growth !== null && d.totals.growthPercent !== null) {
              <span data-total-growth-percent class="text-xs leading-snug text-muted"
                >{{ approx(d.totals.approximate) }}{{ percent(d.totals.growthPercent) }}</span
              >
            }
          </div>
        </section>

        @if (d.months.length > 0) {
          <app-chart-card
            data-chart-section
            title="Saldo över tid"
            [yTicks]="chart()?.yTicks ?? []"
            [xTicks]="chart()?.xTicks ?? []"
            [columns]="columns()"
            [tip]="tip()"
            [legend]="legend()"
            (hovered)="hovered.set($event)"
          >
            <ng-container chart-controls>
              <select
                data-account-select
                class="input w-auto max-w-full min-w-0"
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
              <div class="segmented" role="group" aria-label="Period">
                <button
                  type="button"
                  data-range="year"
                  [attr.aria-pressed]="range() === 'year'"
                  (click)="range.set('year')"
                >
                  1 år
                </button>
                <button
                  type="button"
                  data-range="all"
                  [attr.aria-pressed]="range() === 'all'"
                  (click)="range.set('all')"
                >
                  Allt
                </button>
              </div>
            </ng-container>
            @if (chart(); as c) {
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
            }
          </app-chart-card>
        }

        <section data-accounts class="card flex flex-col gap-4 p-4 sm:p-5">
          <h2 class="card-title">Konton</h2>
          @if (open().length === 0) {
            <app-empty
              icon="piggy-bank"
              text="Inga sparkonton ännu. Markera ett konto som sparkonto på Banker, eller lägg till ett manuellt sparkonto nedan."
            />
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
            <app-disclosure data-closed-accounts label="Avslutade konton" [count]="closed().length">
              <ul class="flex flex-col divide-y divide-line">
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
            </app-disclosure>
          }
        </section>
      }

      <app-manual-savings-section />
    </app-page>

    <ng-template #row let-account>
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span class="min-w-0 font-medium break-words" data-account-name>{{ label(account) }}</span>
        <span class="amount text-lg" data-account-balance>{{ account.balance ?? 0 | money }}</span>
      </div>
      <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        @if (account.netDeposits !== null) {
          <div data-account-deposits>
            <dt class="eyebrow">Insatt</dt>
            <dd class="amount">
              {{ approx(account.approximate) }}{{ account.netDeposits | money }}
            </dd>
          </div>
        }
        @if (account.growth !== null) {
          <div data-account-growth>
            <dt class="eyebrow">Utveckling</dt>
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
            <dt class="eyebrow">Avslutat</dt>
            <dd>{{ account.closedOn | shortDate }}</dd>
          </div>
        }
        <div data-account-updated>
          <dt class="eyebrow">Senast uppdaterad</dt>
          <dd>{{ account.lastUpdated ? (account.lastUpdated | shortDate) : 'aldrig' }}</dd>
        </div>
      </dl>
    </ng-template>
  `,
})
export class SparandePage {
  private readonly read = inject(SavingsStore).savings();
  /** When the device fetched what the page shows; the page says so while offline. */
  protected readonly fetchedAt = computed(() => [this.read.fetchedAt()]);

  protected readonly data = computed<SavingsResponse | null>(() => this.read.value() ?? null);
  protected readonly failed = this.read.failed;
  protected readonly selected = signal<string>(ALL);
  protected readonly range = signal<Range>('year');
  protected readonly hovered = signal<number | null>(null);

  protected readonly open = computed(() =>
    (this.data()?.accounts ?? []).filter((account) => account.closedOn === null),
  );
  protected readonly closed = computed(() =>
    (this.data()?.accounts ?? []).filter((account) => account.closedOn !== null),
  );

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
    return {
      layers,
      deposits: withDeposits.length > 0 ? depositLine : '',
      months: figures.map((f) => f.month),
      tops: tops.map((value) => 100 - pctOf(value)),
      depositTops: deposits.map((value) => (value === null ? null : 100 - pctOf(value))),
      yTicks,
      xTicks: monthTicks(
        figures.map((f) => f.month),
        (i) => (figures.length === 1 ? 0 : (i / (figures.length - 1)) * 100),
      ),
    };
  });

  protected readonly tip = computed<ChartTip | null>(() => {
    const c = this.chart();
    const i = this.hovered();
    const f = i === null ? undefined : this.figures()[i];
    if (c === null || i === null || f === undefined) return null;
    const series = this.series();
    const count = c.months.length;
    const deposits = c.depositTops[i] ?? null;
    return {
      pct: count > 1 ? (i / (count - 1)) * 100 : 0,
      title: MONTH_LONG.format(monthDate(f.month)),
      rows: [
        ...(this.selected() === ALL
          ? series.map((entry, k) => ({
              label: this.label(entry.account),
              colour: entry.colour,
              amount: money.transform(f.balances[k]!),
            }))
          : []),
        { label: 'Totalt', amount: money.transform(f.total), separated: true },
        ...(f.netDeposits === null
          ? []
          : [{ label: 'Insatt', amount: money.transform(f.netDeposits) }]),
        ...(f.growth === null
          ? []
          : [{ label: 'Utveckling i månaden', amount: money.transform(f.growth) }]),
      ],
      markers: [
        { top: c.tops[i]!, colour: 'var(--color-accent)' },
        ...(deposits === null ? [] : [{ top: deposits, colour: 'var(--color-ink)' }]),
      ],
    };
  });

  /** One hover column per month, centred on its point. */
  protected readonly columns = computed<ChartColumn[]>(() => {
    const months = this.chart()?.months ?? [];
    const count = months.length;
    return months.map((key, i) => ({
      key,
      left: count > 1 ? ((i - 0.5) / (count - 1)) * 100 : 0,
      width: count > 1 ? 100 / (count - 1) : 100,
    }));
  });

  protected readonly legend = computed<ChartLegendItem[]>(() => {
    const c = this.chart();
    if (c === null) return [];
    return [
      ...c.layers.map((layer): ChartLegendItem => ({
        label: layer.name,
        colour: layer.colour,
        kind: 'fill',
      })),
      ...(c.deposits
        ? [{ label: 'Insatt', colour: 'var(--color-ink)', kind: 'dashed' } as const]
        : []),
    ];
  });
}
