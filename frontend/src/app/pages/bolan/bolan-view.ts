import type { MortgageFiguresResponse, MortgageMonth } from '@bankapp/shared';
import { DAY_MS } from '../../dates';

/** A highlighted date is one at most this many days away. */
export const HIGHLIGHT_DAYS = 14;

const utc = (day: string) => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, date);
};

/** Whole days from `today` to `day`. */
export function daysUntil(day: string, today: string): number {
  return Math.round((utc(day) - utc(today)) / DAY_MS);
}

/** What a recurring day says about itself: whether it is close, and how to put it. */
export function countdown(day: string, today: string): { soon: boolean; text: string | null } {
  const days = daysUntil(day, today);
  if (days > HIGHLIGHT_DAYS) return { soon: false, text: null };
  if (days <= 0) return { soon: true, text: 'idag' };
  if (days === 1) return { soon: true, text: 'imorgon' };
  return { soon: true, text: `om ${days} dagar` };
}

/** The current month's figures, if the mortgage has any. */
export function currentMonth(
  figures: MortgageFiguresResponse,
  today: string,
): MortgageMonth | undefined {
  return figures.months.find((m) => m.month === today.slice(0, 7));
}

export const RANGES = [
  { id: '1y', label: '1 år' },
  { id: 'all', label: 'Allt' },
] as const;
export type Range = (typeof RANGES)[number]['id'];
export type ChartMode = 'debt' | 'paid';

/** The months the chart shows: the latest 12, or all of them. */
export function inRange(months: MortgageMonth[], range: Range): MortgageMonth[] {
  return range === '1y' ? months.slice(-12) : months;
}

export interface Bar {
  /** Left edge and width, in the chart's own units. */
  x: number;
  width: number;
  y: number;
  height: number;
  series: string;
  colour: string;
}

export interface MortgageChart {
  bars: Bar[];
  /** Centre of each month's slot, as a percentage across the chart. */
  slots: { month: string; pct: number }[];
  yTicks: { value: number; pct: number }[];
  top: number;
}

export const CHART_WIDTH = 300;
export const CHART_HEIGHT = 120;

/** A scale top that is a round number above `value`. */
function niceTop(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * Debt: one stacked bar per month, a segment per part. Paid: two bars per month, the estimate
 * and what was paid.
 */
export function buildChart(
  months: MortgageMonth[],
  mode: ChartMode,
  colours: Map<number | string, string>,
): MortgageChart {
  const slot = CHART_WIDTH / Math.max(months.length, 1);
  const barWidth = Math.min(slot * 0.62, 28);
  const values = months.map((m) =>
    mode === 'debt' ? m.debts.reduce((sum, d) => sum + d.debt, 0) : Math.max(m.total, m.paid),
  );
  const top = niceTop(Math.max(0, ...values));
  const scale = (value: number) => (value / top) * CHART_HEIGHT;
  const bars: Bar[] = [];
  months.forEach((m, i) => {
    const centre = slot * i + slot / 2;
    if (mode === 'debt') {
      let floor = 0;
      for (const part of m.debts) {
        const height = scale(part.debt);
        bars.push({
          x: centre - barWidth / 2,
          width: barWidth,
          y: CHART_HEIGHT - floor - height,
          height,
          series: String(part.partId),
          colour: colours.get(part.partId) ?? 'var(--color-muted)',
        });
        floor += height;
      }
    } else {
      const each = barWidth / 2;
      for (const [n, key, value] of [
        [0, 'estimate', m.total],
        [1, 'paid', m.paid],
      ] as const) {
        const height = scale(value);
        bars.push({
          x: centre - barWidth / 2 + n * each,
          width: each,
          y: CHART_HEIGHT - height,
          height,
          series: key,
          colour: colours.get(key) ?? 'var(--color-muted)',
        });
      }
    }
  });
  return {
    bars,
    slots: months.map((m, i) => ({ month: m.month, pct: ((i + 0.5) / months.length) * 100 })),
    yTicks: [0, top / 2, top].map((value) => ({ value, pct: (value / top) * 100 })),
    top,
  };
}
