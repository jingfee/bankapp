import type { Transaction } from '@bankapp/shared';
import { accountLabel } from './share-display';

describe('share display', () => {
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
