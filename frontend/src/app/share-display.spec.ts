import type { Transaction } from '@bankapp/shared';
import { accountLabel, paidByLabel, shareLabels } from './share-display';

describe('share display', () => {
  const names = { owner: 'Kim', partner: 'Robin' };

  it('names an account, and a manual transaction with who paid it', () => {
    const base = { account: null, paidBy: 'owner' } as Pick<Transaction, 'account' | 'paidBy'>;
    expect(accountLabel(base, names)).toBe('Manuell');
    expect(accountLabel({ ...base, paidBy: 'partner' }, names)).toBe('Manuell · Robin');
    expect(
      accountLabel(
        {
          account: { id: 1, name: 'Lönekonto', bank: 'Swedbank', type: 'payment' },
          paidBy: 'owner',
        },
        names,
      ),
    ).toBe('Lönekonto');
  });

  it('calls Jag and Partner by name', () => {
    expect(shareLabels(names)).toEqual({
      me: 'Kim',
      half: '50/50',
      household: 'Hushåll',
      partner: 'Robin',
    });
    expect([paidByLabel('owner', names), paidByLabel('partner', names)]).toEqual(['Kim', 'Robin']);
  });
});
