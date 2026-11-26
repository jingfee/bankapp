import { transferText } from './balance-display';

describe('the balance text', () => {
  const names = { owner: 'Kim', partner: 'Robin' };

  it.each([
    [120, 'Att överföra: Robin → Kim'],
    [-0.01, 'Att överföra: Kim → Robin'],
    [0, 'Ni är kvitt'],
  ])('says who transfers to whom for %d', (balance, expected) => {
    expect(transferText(balance, names)).toBe(expected);
  });

  it('falls back to Partner and Jag without names', () => {
    expect(transferText(50)).toBe('Att överföra: Partner → Jag');
  });
});
