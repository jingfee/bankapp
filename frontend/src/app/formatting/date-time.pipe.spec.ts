import { DateTimePipe } from './date-time.pipe';

describe('DateTimePipe', () => {
  const pipe = new DateTimePipe();

  it('shows the time in Swedish winter time', () => {
    expect(pipe.transform('2026-11-10T12:00:00.000Z')).toBe('10 nov. 13:00');
  });

  it('shows the time in Swedish summer time', () => {
    expect(pipe.transform('2026-07-01T12:30:00.000Z')).toBe('1 juli 14:30');
  });
});
