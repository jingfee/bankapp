import { DateHeadingPipe } from './date-heading.pipe';

describe('DateHeadingPipe', () => {
  const pipe = new DateHeadingPipe();

  it('writes a calendar day in Swedish with weekday and a capital letter', () => {
    expect(pipe.transform('2026-11-10')).toBe('Tisdag 10 november 2026');
  });

  it('does not shift the day with the timezone of the device', () => {
    expect(pipe.transform('2026-01-01')).toBe('Torsdag 1 januari 2026');
  });
});
