import { addMonths, inForce, nextOccurrence } from '../src/mortgage/figures';

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

describe('addMonths', () => {
  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('crosses years', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-12-15', 12)).toBe('2027-12-15');
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
