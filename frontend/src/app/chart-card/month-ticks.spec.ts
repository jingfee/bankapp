import { describe, expect, it } from 'vitest';
import { monthTicks } from './month-ticks';

const months = (from: string, count: number) => {
  const [year, month] = from.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const n = month - 1 + i;
    return `${year + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
  });
};

describe('monthTicks', () => {
  it('names the short month with no dot and no year inside one year', () => {
    const ticks = monthTicks(months('2026-07', 5), (i) => i * 25);

    expect(ticks.map((t) => t.label)).toEqual(['juli', 'aug', 'sep', 'okt', 'nov']);
    expect(ticks.map((t) => t.pct)).toEqual([0, 25, 50, 75, 100]);
  });

  it('adds the year only at a year boundary', () => {
    const ticks = monthTicks(months('2026-10', 4), (i) => i);

    expect(ticks.map((t) => t.label)).toEqual(['okt', 'nov', 'dec', 'jan 2027']);
  });

  it('thins out a long range and still labels the last month', () => {
    const ticks = monthTicks(months('2025-01', 20), (i) => i);

    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks[0]!.pct).toBe(0);
    expect(ticks.at(-1)!.pct).toBe(19);
    expect(ticks.filter((t) => /\d{4}/.test(t.label))).toHaveLength(1);
  });

  it('has no ticks without months', () => {
    expect(monthTicks([], () => 0)).toEqual([]);
  });
});
