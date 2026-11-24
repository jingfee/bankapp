import { addMonths, isMonth, lastDayOf, shiftMonth } from './dates';

describe('dates', () => {
  it.each([
    ['2026-01', true],
    ['2026-12', true],
    ['2026-00', false],
    ['2026-13', false],
    ['2026-1', false],
    ['2026-01-01', false],
    ['', false],
  ])('isMonth(%j) is %s', (value, expected) => {
    expect(isMonth(value)).toBe(expected);
  });

  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-11-15', 3, '2027-02-15'],
    ['2026-12-15', 12, '2027-12-15'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-01-15', -1, '2025-12-15'],
    ['2026-06-10', 0, '2026-06-10'],
    ['2026-05-31', 1, '2026-06-30'],
    ['2026-01-31', 2, '2026-03-31'],
  ])('addMonths(%s, %i) is %s', (day, months, expected) => {
    expect(addMonths(day, months)).toBe(expected);
  });

  it.each([
    ['2026-01', '2026-01-31'],
    ['2026-04', '2026-04-30'],
    ['2026-02', '2026-02-28'],
    ['2024-02', '2024-02-29'],
    ['2100-02', '2100-02-28'],
    ['2026-12', '2026-12-31'],
  ])('the last day of %s is %s', (month, expected) => {
    expect(lastDayOf(month)).toBe(expected);
  });

  it.each([
    ['2026-06', 1, '2026-07'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
  ])('shiftMonth(%s, %i) is %s', (month, by, expected) => {
    expect(shiftMonth(month, by)).toBe(expected);
  });
});
