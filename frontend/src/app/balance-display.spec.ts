import { owesText } from './balance-display';

describe('the balance text', () => {
  it.each([
    [120, 'Partnern är skyldig dig'],
    [-0.01, 'Du är skyldig partnern'],
    [0, 'Ni är kvitt'],
  ])('says who owes whom for %d', (balance, expected) => {
    expect(owesText(balance)).toBe(expected);
  });

  it('lets a page word the settled case itself', () => {
    expect(owesText(0, { zero: 'Partnern är skyldig dig' })).toBe('Partnern är skyldig dig');
    expect(owesText(-5, { zero: 'Partnern är skyldig dig' })).toBe('Du är skyldig partnern');
  });
});
