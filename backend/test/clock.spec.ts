import { clock } from '../src/clock';

describe('the clock', () => {
  it.each([
    // 23:30 UTC is already the next day in Stockholm, in winter and in summer.
    ['2026-11-15T23:30:00Z', 'Europe/Stockholm', '2026-11-16'],
    ['2026-06-30T22:30:00Z', 'Europe/Stockholm', '2026-07-01'],
    ['2026-11-15T22:59:59Z', 'Europe/Stockholm', '2026-11-15'],
    ['2026-11-16T03:00:00Z', 'America/New_York', '2026-11-15'],
  ])('at %s gives today in %s as %s', (moment, timezone, day) => {
    expect(clock(() => new Date(moment), timezone).today()).toBe(day);
  });

  it('gives the current moment as now', () => {
    const moment = new Date('2026-11-15T12:00:00Z');
    expect(clock(() => moment, 'Europe/Stockholm').now()).toBe(moment);
  });
});
