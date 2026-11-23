import { ShortDatePipe, shortDate } from './short-date.pipe';

describe('shortDate', () => {
  const today = new Date(2026, 10, 22);

  it('omits the year in the current year', () => {
    expect(shortDate('2026-11-03', today)).toBe('3 nov');
    expect(shortDate('2026-05-01', today)).toBe('1 maj');
  });

  it('includes the year in another year', () => {
    expect(shortDate('2025-11-03', today)).toBe('3 nov 2025');
    expect(shortDate('2027-01-15', today)).toBe('15 jan 2027');
  });

  it('follows the calendar year at its boundaries', () => {
    expect(shortDate('2026-01-01', today)).toBe('1 jan');
    expect(shortDate('2026-12-31', today)).toBe('31 dec');
    expect(shortDate('2025-12-31', today)).toBe('31 dec 2025');
    expect(shortDate('2027-01-01', today)).toBe('1 jan 2027');
  });

  it('does not shift the day with the timezone of the device', () => {
    expect(shortDate('2026-01-01', new Date(2026, 5, 1))).toBe('1 jan');
  });

  it('is available as a pipe', () => {
    const thisYear = new Date().getFullYear();
    expect(new ShortDatePipe().transform(`${thisYear}-03-04`)).toBe('4 mars');
  });
});
