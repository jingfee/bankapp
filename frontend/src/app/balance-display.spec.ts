import { owesText } from './balance-display';

describe('the balance text', () => {
  it.each([
    [120, 'Partnern är skyldig dig'],
    [-0.01, 'Du är skyldig partnern'],
    [0, 'Ni är kvitt'],
  ])('says who owes whom for %d', (balance, expected) => {
    expect(owesText(balance)).toBe(expected);
  });
});
