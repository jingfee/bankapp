import { MoneyPipe } from './money.pipe';

describe('MoneyPipe', () => {
  const pipe = new MoneyPipe();

  // Swedish formatting uses a no-break space as thousands separator and before the currency, and
  // the typographic minus sign (U+2212), so it reads as `-1 234,50 kr`.
  it('formats a negative SEK sum the Swedish way', () => {
    expect(pipe.transform(-1234.5)).toBe('−1 234,50 kr');
  });

  it('formats a positive sum with two decimals', () => {
    expect(pipe.transform(89)).toBe('89,00 kr');
  });

  it('uses the given currency', () => {
    expect(pipe.transform(10, 'EUR')).toBe('10,00 €');
  });
});
