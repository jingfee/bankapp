import type { Transaction } from '@bankapp/shared';
import { accountLabel, householdLabel, shareLabel } from './share-display';

const ratio = [
  { from: '2026-01-01', percent: 60 },
  { from: '2026-11-10', percent: 55 },
];

describe('share display', () => {
  it('labels Hushåll with the ratio in force on the date', () => {
    expect(householdLabel(ratio, '2026-11-09')).toBe('Hushåll (60/40)');
    expect(householdLabel(ratio, '2026-11-10')).toBe('Hushåll (55/45)');
    expect(householdLabel(ratio, null)).toBe('Hushåll (60/40)');
  });

  it('labels Hushåll plainly when no ratio is known', () => {
    expect(householdLabel(null, '2026-11-09')).toBe('Hushåll');
    expect(householdLabel([], '2026-11-09')).toBe('Hushåll');
  });

  it('names the other options the same everywhere', () => {
    expect(['me', 'half', 'partner'].map((o) => shareLabel(o as 'me'))).toEqual([
      'Jag',
      '50/50',
      'Partner',
    ]);
    expect(shareLabel('household', { entries: ratio, date: '2026-11-20' })).toBe('Hushåll (55/45)');
  });

  it('names an account, and a manual transaction with who paid it', () => {
    const base = { account: null, paidBy: 'owner' } as Pick<Transaction, 'account' | 'paidBy'>;
    expect(accountLabel(base)).toBe('Manuell');
    expect(accountLabel({ ...base, paidBy: 'partner' })).toBe('Manuell · Partner');
    expect(
      accountLabel({
        account: { id: 1, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
        paidBy: 'owner',
      }),
    ).toBe('Lönekonto');
  });
});
