import {
  InvalidInput,
  NoHouseholdRatio,
  NoSuchAccount,
  NoSuchSubcategory,
  NoSuchTransaction,
  FollowsPurchase,
} from '../src/domain-errors';
import { Shares } from '../src/transactions/shares';
import { moduleApp } from './transaction-modules';

describe('the share settings module', () => {
  let ctx: Awaited<ReturnType<typeof moduleApp>>;
  let shares: Shares;

  beforeEach(async () => {
    ctx = await moduleApp();
    shares = ctx.app.get(Shares);
  });
  afterEach(() => ctx.app.close());

  it('validates the household ratio itself', () => {
    expect(() => shares.setHouseholdRatio([])).toThrow(InvalidInput);
    expect(() => shares.setHouseholdRatio('x')).toThrow('at least one entry');
    expect(() => shares.setHouseholdRatio([{ from: '2026-02-30', percent: 50 }])).toThrow(
      'YYYY-MM-DD',
    );
    expect(() => shares.setHouseholdRatio([{ from: '2026-01-01', percent: 100 }])).toThrow(
      '1 to 99',
    );
    expect(() =>
      shares.setHouseholdRatio([
        { from: '2026-01-01', percent: 40 },
        { from: '2026-01-01', percent: 60 },
      ]),
    ).toThrow('same day');
    expect(shares.householdRatio()).toEqual([]);
    expect(shares.setHouseholdRatio([{ from: '2026-01-01', percent: 60 }])).toEqual([
      { from: '2026-01-01', percent: 60 },
    ]);
  });

  it('needs a household ratio before Hushåll anywhere', () => {
    const tx = ctx.store(-10, 'x');
    expect(() => shares.setAccountShare(1, 'household')).toThrow(NoHouseholdRatio);
    expect(() => shares.setSubcategoryShare(ctx.subcategory, 'household')).toThrow(
      NoHouseholdRatio,
    );
    expect(() => shares.setTransactionShare(tx, 'household')).toThrow(NoHouseholdRatio);
    shares.setHouseholdRatio([{ from: '2026-01-01', percent: 60 }]);
    expect(() => shares.setAccountShare(1, 'household')).not.toThrow();
  });

  it('sets and clears shares, and says what is missing', () => {
    shares.setSubcategoryShare(ctx.subcategory, 'half');
    expect(shares.subcategoryShares()).toEqual([{ subcategoryId: ctx.subcategory, share: 'half' }]);
    shares.setSubcategoryShare(ctx.subcategory, 'me');
    expect(shares.subcategoryShares()).toEqual([]);
    expect(() => shares.setAccountShare(99, 'half')).toThrow(NoSuchAccount);
    expect(() => shares.setSubcategoryShare(99999, 'half')).toThrow(NoSuchSubcategory);
    expect(() => shares.setTransactionShare(999, 'half')).toThrow(NoSuchTransaction);
    expect(() => shares.setAccountShare(1, 'nobody')).toThrow(InvalidInput);
    expect(() => shares.setAccountShare(1, null)).toThrow(InvalidInput);
    expect(() => shares.setTransactionShare(ctx.store(-1, 'y'), 'nobody')).toThrow(InvalidInput);
  });

  it('gives an offset refund no share of its own', () => {
    const purchase = ctx.store(-100, 'Buy');
    const refund = ctx.store(50, 'Refund', { offsetsTransactionId: purchase });
    expect(() => shares.setTransactionShare(refund, 'half')).toThrow(FollowsPurchase);
    expect(() => shares.setTransactionShare(purchase, null)).not.toThrow();
  });
});
