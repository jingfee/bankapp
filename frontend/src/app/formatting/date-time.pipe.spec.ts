import { dateTime } from './date-time.pipe';

describe('dateTime', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');

  it('says idag for today, in Swedish time', () => {
    expect(dateTime('2026-11-23T10:00:00.000Z', now)).toBe('idag 11:00');
  });

  it('says igår for yesterday', () => {
    expect(dateTime('2026-11-22T10:00:00.000Z', now)).toBe('igår 11:00');
  });

  it('shows the date without year or dot earlier this year', () => {
    expect(dateTime('2026-11-10T12:00:00.000Z', now)).toBe('10 nov 13:00');
    expect(dateTime('2026-07-01T12:30:00.000Z', now)).toBe('1 juli 14:30');
  });

  it('adds the year when it is not the current year', () => {
    expect(dateTime('2025-11-22T10:00:00.000Z', now)).toBe('22 nov 2025 11:00');
  });

  it('uses the Swedish day, not the UTC day, around midnight', () => {
    expect(dateTime('2026-11-22T23:30:00.000Z', now)).toBe('idag 00:30');
  });
});
