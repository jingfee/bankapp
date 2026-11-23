import { APP_LOCALE } from '../formatting/locale';

const MONTH = new Intl.DateTimeFormat(APP_LOCALE, { month: 'short' });

/** The most labels that fit under the axis at 320 px without touching. */
const MAX_TICKS = 5;

/**
 * X labels for a chart of months (`YYYY-MM`): the short month name ("nov"), and the year only
 * where it changes ("jan 2027"). `pctOf` is where month `i` sits along the axis.
 */
export function monthTicks(
  months: string[],
  pctOf: (index: number) => number,
): { label: string; pct: number }[] {
  if (months.length === 0) return [];
  const every = Math.max(1, Math.ceil(months.length / MAX_TICKS));
  const indexes = months.flatMap((_, i) => (i % every === 0 ? [i] : []));
  // Keep the last month labelled without crowding the one before it.
  const last = months.length - 1;
  if (indexes.at(-1) !== last) {
    if (last - indexes.at(-1)! < every / 2 + 0.5) indexes.pop();
    indexes.push(last);
  }
  return indexes.map((i, k) => {
    const month = months[i]!;
    const year = month.slice(0, 4);
    const previous = k === 0 ? undefined : months[indexes[k - 1]!]!.slice(0, 4);
    const name = MONTH.format(new Date(Number(year), Number(month.slice(5, 7)) - 1, 1)).replace(
      /\.$/,
      '',
    );
    return {
      label: previous !== undefined && previous !== year ? `${name} ${year}` : name,
      pct: pctOf(i),
    };
  });
}
