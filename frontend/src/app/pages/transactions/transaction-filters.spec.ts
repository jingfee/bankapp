import { convertToParamMap } from '@angular/router';
import {
  AMOUNT_PRESETS,
  EMPTY_FILTERS,
  activeFilterCount,
  filtersFromParams,
  filtersToParams,
  periodPresets,
  samePeriod,
} from './transaction-filters';

describe('transaction filters', () => {
  it('reads the query string, ignoring what is not valid', () => {
    const filters = filtersFromParams(
      convertToParamMap({
        q: ' ica ',
        from: '2026-11-01',
        to: 'tomorrow',
        accounts: '3,manual,x',
        categories: '4,none',
        kind: 'out',
        min: '100',
        max: '5,5',
      }),
    );

    expect(filters).toEqual({
      q: 'ica',
      from: '2026-11-01',
      to: '',
      accounts: ['3', 'manual'],
      categories: ['4', 'none'],
      kind: 'out',
      min: '100',
      max: '5.5',
    });
  });

  it('writes only what is set, and round-trips', () => {
    const filters = {
      ...EMPTY_FILTERS,
      q: 'ica',
      from: '2026-11-01',
      to: '2026-11-30',
      accounts: ['1', 'manual'],
      categories: ['none'],
      kind: 'in' as const,
      min: '100',
      max: '500',
    };

    const params = filtersToParams(filters);

    expect(params).toEqual({
      q: 'ica',
      from: '2026-11-01',
      to: '2026-11-30',
      accounts: '1,manual',
      categories: 'none',
      kind: 'in',
      min: '100',
      max: '500',
    });
    expect(filtersFromParams(convertToParamMap(params))).toEqual(filters);
    expect(filtersToParams(EMPTY_FILTERS)).toEqual({});
  });

  it('counts the filters in the panel, not the search', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: 'ica' })).toBe(0);
    expect(
      activeFilterCount({
        ...EMPTY_FILTERS,
        from: '2026-11-01',
        to: '2026-11-30',
        kind: 'out',
        min: '1',
        max: '2',
        accounts: ['1', '2'],
        categories: ['3'],
      }),
    ).toBe(5);
  });

  it('knows the quick periods of a day', () => {
    const presets = periodPresets(new Date(2026, 10, 15));

    expect(presets.last7).toEqual({ from: '2026-11-09', to: '' });
    expect(presets.month).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(
      samePeriod(presets.month, { ...EMPTY_FILTERS, from: '2026-11-01', to: '2026-11-30' }),
    ).toBe(true);
    expect(samePeriod(presets.month, EMPTY_FILTERS)).toBe(false);
  });

  it('has the amount presets from the issue', () => {
    expect(AMOUNT_PRESETS.map((p) => p.label)).toEqual([
      'Under 100 kr',
      '100–500 kr',
      '500–2 000 kr',
      'Över 2 000 kr',
    ]);
  });
});
