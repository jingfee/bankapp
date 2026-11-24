import {
  addMonths,
  daysInMonth,
  endedDaysAgo,
  isDay,
  isMonth,
  monthEnd,
  monthOfDay,
  nextDay,
  nextMonth,
  previousMonth,
  shiftMonth,
} from '../src/calendar';

describe('the calendar', () => {
  it.each([
    ['2026-01', true],
    ['2026-12', true],
    ['0001-06', true],
    ['2026-00', false],
    ['2026-13', false],
    ['2026-1', false],
    ['26-01', false],
    ['2026-01-01', false],
    [' 2026-01', false],
    ['', false],
  ])('isMonth(%j) is %s', (value, expected) => {
    expect(isMonth(value)).toBe(expected);
  });

  it.each([
    ['2026-11-24', true],
    ['2024-02-29', true],
    ['2026-12-31', true],
    ['2026-02-29', false],
    ['2100-02-29', false],
    ['2026-04-31', false],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-11-00', false],
    ['2026-11-1', false],
    ['2026-11', false],
    ['2026-11-24T00:00:00Z', false],
    ['', false],
  ])('isDay(%j) is %s', (value, expected) => {
    expect(isDay(value)).toBe(expected);
  });

  it.each([
    ['2026-06', 0, '2026-06'],
    ['2026-06', 1, '2026-07'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-03', -15, '2024-12'],
    ['2026-11', 14, '2028-01'],
    ['2026-12', 12, '2027-12'],
  ])('shiftMonth(%s, %i) is %s', (month, by, expected) => {
    expect(shiftMonth(month, by)).toBe(expected);
  });

  it.each([
    ['2026-06', '2026-07', '2026-05'],
    ['2026-12', '2027-01', '2026-11'],
    ['2026-01', '2026-02', '2025-12'],
  ])('the month after %s is %s and the one before is %s', (month, next, previous) => {
    expect(nextMonth(month)).toBe(next);
    expect(previousMonth(month)).toBe(previous);
  });

  it.each([
    ['2026-11-24', '2026-11-25'],
    ['2026-11-30', '2026-12-01'],
    ['2026-12-31', '2027-01-01'],
    ['2024-02-28', '2024-02-29'],
    ['2024-02-29', '2024-03-01'],
    ['2026-02-28', '2026-03-01'],
  ])('the day after %s is %s', (day, expected) => {
    expect(nextDay(day)).toBe(expected);
  });

  it.each([
    ['2026-01', '2026-01-31'],
    ['2026-04', '2026-04-30'],
    ['2026-02', '2026-02-28'],
    ['2024-02', '2024-02-29'],
    ['2100-02', '2100-02-28'],
    ['2000-02', '2000-02-29'],
    ['2026-12', '2026-12-31'],
  ])('the last day of %s is %s', (month, expected) => {
    expect(monthEnd(month)).toBe(expected);
    expect(daysInMonth(month)).toBe(Number(expected.slice(8)));
  });

  it('gives the month of a day', () => {
    expect(monthOfDay('2026-11-24')).toBe('2026-11');
  });

  it.each([
    ['2026-10', '2026-11-07', 7],
    ['2026-10', '2026-10-31', 0],
    ['2026-10', '2026-10-15', -16],
    ['2026-12', '2027-01-02', 2],
    ['2024-02', '2024-03-01', 1],
    ['2026-02', '2026-03-01', 1],
  ])('month %s ended %s days ago on %s', (month, today, expected) => {
    expect(endedDaysAgo(month, today)).toBe(expected);
  });

  it.each([
    ['2026-01-15', 1, '2026-02-15'],
    ['2026-01-31', 1, '2026-02-28'],
    ['2024-01-31', 1, '2024-02-29'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-12-15', 1, '2027-01-15'],
    ['2026-01-15', -1, '2025-12-15'],
    ['2026-01-31', 3, '2026-04-30'],
    ['2026-05-31', 12, '2027-05-31'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2026-06-10', 0, '2026-06-10'],
  ])('addMonths(%s, %i) is %s', (day, months, expected) => {
    expect(addMonths(day, months)).toBe(expected);
  });
});
