import { inForce, mortgageTotals, needsNewRate, nextOccurrence } from '../src/mortgage/figures';

describe('inForce', () => {
  const changes = [
    { from: '2026-01-01', value: 3.5 },
    { from: '2026-06-01', value: 3.85 },
    { from: '2026-03-01', value: 3.6 },
  ];

  it('is the latest change on or before the day', () => {
    expect(inForce(changes, '2026-05-31')).toBe(3.6);
    expect(inForce(changes, '2026-06-01')).toBe(3.85);
    expect(inForce(changes, '2030-01-01')).toBe(3.85);
  });

  it('is null before the first change', () => {
    expect(inForce(changes, '2025-12-31')).toBeNull();
    expect(inForce([], '2026-01-01')).toBeNull();
  });
});

describe('nextOccurrence', () => {
  it('rolls a passed date forward by the interval', () => {
    expect(nextOccurrence('2026-11-15', 3, '2026-11-20')).toBe('2027-02-15');
  });

  it('repeats until the date is in the future', () => {
    expect(nextOccurrence('2026-01-15', 3, '2026-11-20')).toBe('2027-01-15');
  });

  it('keeps a date that is today or later', () => {
    expect(nextOccurrence('2026-11-20', 3, '2026-11-20')).toBe('2026-11-20');
    expect(nextOccurrence('2027-05-01', 3, '2026-11-20')).toBe('2027-05-01');
  });

  it('does not drift after a short month', () => {
    expect(nextOccurrence('2026-01-31', 1, '2026-03-01')).toBe('2026-03-31');
  });

  it('moves the series when the date is edited', () => {
    expect(nextOccurrence('2026-11-25', 3, '2026-11-20')).toBe('2026-11-25');
  });
});

describe('needsNewRate', () => {
  const today = '2026-11-15';
  const part = { startedOn: '2026-01-10', endedOn: null, rateChanges: [{ from: '2026-01-10' }] };
  const every3 = (next: string) => ({ next, intervalMonths: 3 });

  it.each([
    ['on the rate adjustment day', part, every3('2026-11-15'), true],
    // Next is 2027-01-10, so the day that passed was 2026-10-10.
    ['after the day, with no rate change since', part, every3('2027-01-10'), true],
    [
      'once a rate change is dated on the day',
      { ...part, rateChanges: [{ from: '2026-10-10' }] },
      every3('2027-01-10'),
      false,
    ],
    [
      'once a rate change is dated after the day',
      { ...part, rateChanges: [{ from: '2026-11-01' }] },
      every3('2027-01-10'),
      false,
    ],
    ['before the day', part, every3('2027-02-20'), false],
    [
      'before the first adjustment day of a new part',
      { ...part, startedOn: '2026-11-01', rateChanges: [{ from: '2026-11-01' }] },
      every3('2027-02-01'),
      false,
    ],
    [
      'when the day that passed was before the part started',
      { ...part, startedOn: '2026-11-01', rateChanges: [] },
      every3('2027-01-10'),
      false,
    ],
    ['for an ended part', { ...part, endedOn: '2026-11-01' }, every3('2026-11-15'), false],
  ])('%s is %s', (_name, loanPart, rateAdjustment, expected) => {
    expect(needsNewRate(loanPart, rateAdjustment, today)).toBe(expected);
  });
});

describe('mortgageTotals', () => {
  it('weights the rates by debt', () => {
    const { totalDebt, averageRate } = mortgageTotals([
      { debt: 990_000, rate: 3.85 },
      { debt: 500_000, rate: 4.1 },
    ]);
    expect(totalDebt).toBe(1_490_000);
    expect(averageRate).toBeCloseTo((990_000 * 3.85 + 500_000 * 4.1) / 1_490_000, 10);
  });

  it('leaves a part with no rate out of the average but not the debt', () => {
    expect(
      mortgageTotals([
        { debt: 100_000, rate: null },
        { debt: 300_000, rate: 4 },
      ]),
    ).toEqual({ totalDebt: 400_000, averageRate: 4 });
  });

  it('has no average without rated debt', () => {
    expect(mortgageTotals([])).toEqual({ totalDebt: 0, averageRate: null });
    expect(mortgageTotals([{ debt: 0, rate: 4 }])).toEqual({ totalDebt: 0, averageRate: null });
  });
});
