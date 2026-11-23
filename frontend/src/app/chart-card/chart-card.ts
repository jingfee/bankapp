import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export interface ChartTick {
  label: string;
  /** Where the tick sits along its axis, as a percentage. */
  pct: number;
}

/** One hover column across the plot, as percentages of its width. */
export interface ChartColumn {
  key: string | number;
  left: number;
  width: number;
}

export interface ChartLegendItem {
  label: string;
  colour: string;
  /** A fill (area or bar) is a square; a line is a short stroke, optionally dashed. */
  kind: 'fill' | 'line' | 'dashed';
}

export interface ChartTipRow {
  label: string;
  amount: string;
  /** A dot in this colour leads the row; no dot for rows that are not a series. */
  colour?: string;
  /** A rule above the row, for a total. */
  separated?: boolean;
}

export interface ChartTip {
  /** Where the hovered point sits across the plot, as a percentage. */
  pct: number;
  title?: string;
  rows: ChartTipRow[];
  /** A dot on the plot per series: its height as a percentage from the top. */
  markers?: { top: number; colour: string }[];
}

/**
 * The card every chart sits in: a title, controls on the right (wrapping below on phones), the
 * axes, hover columns, one tooltip and one legend. The page draws the series.
 *
 * Slots: `[chart-controls]` is the segmented controls and selects; the `<svg>` is the drawing,
 * in a 300 x 120 view box.
 */
@Component({
  selector: 'app-chart-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'card block min-w-0 p-4 sm:p-5' },
  template: `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h2 class="card-title">{{ title() }}</h2>
      <div class="flex flex-wrap items-center gap-2"><ng-content select="[chart-controls]" /></div>
    </div>
    @if (summary(); as text) {
      <p data-chart-summary class="-mt-2 mb-4 text-sm text-muted">{{ text }}</p>
    }
    <div class="flex min-w-0 gap-2">
      <div class="relative h-40 w-16 shrink-0" aria-hidden="true">
        @for (tick of yTicks(); track tick.pct) {
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
          class="relative h-40 touch-pan-y"
          (pointerleave)="hovered.emit(null)"
          (pointerdown)="touch($event)"
          (pointermove)="touch($event)"
        >
          @for (tick of yTicks(); track tick.pct) {
            <div class="absolute inset-x-0 border-t border-line" [style.bottom.%]="tick.pct"></div>
          }
          <ng-content select="svg" />

          @if (tip(); as t) {
            <div
              class="pointer-events-none absolute inset-y-0 w-px bg-line-strong"
              [style.left.%]="t.pct"
            ></div>
            @for (marker of t.markers ?? []; track $index) {
              <span
                class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                [style.left.%]="t.pct"
                [style.top.%]="marker.top"
                [style.background]="marker.colour"
              ></span>
            }
            <div
              data-chart-tooltip
              class="pointer-events-none absolute top-0 z-10 flex flex-col gap-1 rounded-[10px] border border-line-strong bg-surface-3 px-3 py-2 text-xs whitespace-nowrap shadow-lg"
              [style.left.%]="t.pct"
              [style.transform]="'translateX(-' + t.pct + '%)'"
            >
              @if (t.title) {
                <span class="font-semibold capitalize">{{ t.title }}</span>
              }
              @for (row of t.rows; track $index) {
                <span
                  class="flex items-center gap-2"
                  [class.border-t]="row.separated"
                  [class.border-line]="row.separated"
                  [class.pt-1]="row.separated"
                >
                  @if (row.colour) {
                    <span class="size-2 rounded-full" [style.background]="row.colour"></span>
                  }
                  {{ row.label }}
                  <span class="amount ml-auto">{{ row.amount }}</span>
                </span>
              }
            </div>
          }

          @for (column of plotColumns(); track column.key; let i = $index) {
            <div
              class="absolute inset-y-0"
              [attr.data-chart-column]="column.key"
              [style.left.%]="column.left"
              [style.width.%]="column.width"
              (pointerenter)="hovered.emit(i)"
            ></div>
          }
        </div>
        <div class="relative mt-1 h-4" aria-hidden="true">
          @for (tick of xTicks(); track tick.pct) {
            <span
              data-x-tick
              class="absolute text-[11px] whitespace-nowrap text-muted"
              [style.left.%]="tick.pct"
              [style.transform]="'translateX(-' + tick.pct + '%)'"
              >{{ tick.label }}</span
            >
          }
        </div>
      </div>
    </div>
    <p data-legend class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      @for (item of legend(); track item.label) {
        <span class="flex items-center gap-1.5">
          @switch (item.kind) {
            @case ('fill') {
              <span class="size-2.5 rounded-sm" [style.background]="item.colour"></span>
            }
            @case ('line') {
              <span class="h-0.5 w-4 rounded" [style.background]="item.colour"></span>
            }
            @case ('dashed') {
              <span
                class="h-0 w-4 border-t-2 border-dashed"
                [style.border-color]="item.colour"
              ></span>
            }
          }
          {{ item.label }}
        </span>
      }
    </p>
  `,
})
export class ChartCard {
  readonly title = input.required<string>();
  readonly summary = input<string | null>(null);
  readonly yTicks = input<ChartTick[]>([]);
  readonly xTicks = input<ChartTick[]>([]);
  readonly columns = input<ChartColumn[]>([]);
  /** The columns clamped to the plot, so the first and last never stick out past its edges. */
  protected readonly plotColumns = computed(() =>
    this.columns().map((column) => {
      const left = Math.min(Math.max(column.left, 0), 100);
      const right = Math.min(Math.max(column.left + column.width, 0), 100);
      return { ...column, left, width: right - left };
    }),
  );
  readonly tip = input<ChartTip | null>(null);
  readonly legend = input<ChartLegendItem[]>([]);

  /** The index of the column the pointer is on, or `null` when it leaves the plot. */
  readonly hovered = output<number | null>();

  /**
   * Follows a finger across the plot. A touch pointer is captured by the element it landed on,
   * so the columns never see it enter; the column nearest its x position is the hovered one.
   */
  protected touch(event: PointerEvent): void {
    const columns = this.plotColumns();
    if (event.pointerType !== 'touch' || columns.length === 0) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (box.width <= 0) return;
    const pct = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1) * 100;
    let nearest = 0;
    columns.forEach((column, i) => {
      const distance = Math.abs(column.left + column.width / 2 - pct);
      const best = Math.abs(columns[nearest]!.left + columns[nearest]!.width / 2 - pct);
      if (distance < best) nearest = i;
    });
    this.hovered.emit(nearest);
  }
}
