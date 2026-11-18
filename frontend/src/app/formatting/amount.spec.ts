import { formatAmountInput, parseAmount } from './amount';

describe('parseAmount', () => {
  it('reads a decimal comma', () => expect(parseAmount('1234,56')).toBe(1234.56));
  it('tolerates a decimal dot', () => expect(parseAmount('1234.56')).toBe(1234.56));
  it('reads integers', () => expect(parseAmount('89')).toBe(89));
  it('ignores spaces and no-break spaces as thousands separators', () => {
    expect(parseAmount('1 234,50')).toBe(1234.5);
    expect(parseAmount('1 234,50')).toBe(1234.5);
  });
  it('reads a negative amount', () => {
    expect(parseAmount('-12,5')).toBe(-12.5);
    expect(parseAmount('−12,5')).toBe(-12.5);
  });
  it('trims', () => expect(parseAmount('  7,5 ')).toBe(7.5));
  it.each(['', ' ', '12,3,4', '1.2,3', 'abc', '12,', ',5', '1e3', '--1', '12-'])(
    'rejects %j',
    (text) => expect(parseAmount(text)).toBeNull(),
  );
});

describe('formatAmountInput', () => {
  it('uses a decimal comma without grouping', () =>
    expect(formatAmountInput(1234.56)).toBe('1234,56'));
  it('drops needless decimals', () => expect(formatAmountInput(12)).toBe('12'));
  it('keeps a single decimal as is', () => expect(formatAmountInput(12.5)).toBe('12,5'));
  it('round-trips', () => expect(parseAmount(formatAmountInput(0.07))).toBe(0.07));
});
