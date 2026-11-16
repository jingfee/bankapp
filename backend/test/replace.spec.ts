import { transactions } from '../src/db/schema';
import {
  AlreadyReplaced,
  NoSuchTransaction,
  NotAManualAndBankPair,
  NotReplaceable,
} from '../src/domain-errors';
import { Replace } from '../src/transactions/replace';
import { moduleApp } from './transaction-modules';

describe('the replace module', () => {
  let ctx: Awaited<ReturnType<typeof moduleApp>>;
  let replace: Replace;

  beforeEach(async () => {
    ctx = await moduleApp();
    replace = ctx.app.get(Replace);
  });
  afterEach(() => ctx.app.close());

  const manual = (amount = -100, values = {}) =>
    ctx.store(amount, 'Kaffe', {
      accountId: null,
      paidBy: 'owner',
      subcategoryId: ctx.subcategory,
      categoryConfirmed: true,
      ...values,
    });

  it('suggests the closest bank transaction within 2 kr or 2% and 5 days, once per pair', () => {
    const m = manual(-100);
    const near = ctx.store(-101.5, 'Kaffe AB', { date: '2026-12-03' });
    ctx.store(-110, 'Too far in amount');
    ctx.store(-100, 'Too far in time', { date: '2026-12-09' });
    expect(replace.suggestions().map((s) => [s.manual.id, s.bank.id])).toEqual([[m, near]]);
  });

  it.each([
    ['partner paid', { paidBy: 'partner' as const }],
    ['money in', { amount: 100 }],
  ])('suggests nothing for a manual transaction that is %s', (_, values) => {
    manual(-100, values);
    ctx.store(-100, 'Kaffe');
    expect(replace.suggestions()).toEqual([]);
  });

  it('never suggests a bank transaction that is a refund, in euro or already replacing', () => {
    manual(-100);
    const refunded = ctx.store(-100, 'Purchase');
    ctx.store(-100, 'Refund-linked', { offsetsTransactionId: refunded });
    ctx.store(-100, 'Euro', { currency: 'EUR' });
    const taken = ctx.store(-100, 'Taken', { replacesTransactionId: manual(-3) });
    expect(replace.suggestions().map((s) => s.bank.id)).not.toContain(taken);
    expect(replace.suggestions().map((s) => s.bank.description)).toEqual(['Purchase']);
  });

  it('does not suggest a pair that was marked not the same', () => {
    const m = manual(-100);
    const bank = ctx.store(-100, 'Kaffe');
    replace.notSame(m, bank);
    expect(replace.suggestions()).toEqual([]);
  });

  it('replaces: the bank transaction takes subcategory, share and the refunds', () => {
    const m = manual(-100, { share: 'half' });
    const bank = ctx.store(-100, 'Kaffe');
    const refund = ctx.store(40, 'Refund', { offsetsTransactionId: m });
    replace.replace(m, bank);
    const rows = Object.fromEntries(
      ctx.db
        .select()
        .from(transactions)
        .all()
        .map((r) => [r.id, r]),
    );
    expect(rows[bank]).toMatchObject({
      subcategoryId: ctx.subcategory,
      categoryConfirmed: true,
      share: 'half',
      replacesTransactionId: m,
    });
    expect(rows[refund]).toMatchObject({
      offsetsTransactionId: bank,
      subcategoryId: ctx.subcategory,
    });
  });

  it('refuses what is not eligible, taken, or missing', () => {
    const m = manual(-100);
    const bank = ctx.store(-100, 'Kaffe');
    expect(() => replace.replace(bank, m)).toThrow(NotReplaceable);
    expect(() => replace.replace(m, ctx.store(-100, 'Euro', { currency: 'EUR' }))).toThrow(
      NotReplaceable,
    );
    expect(() => replace.replace(manual(-5, { paidBy: 'partner' }), bank)).toThrow(NotReplaceable);
    expect(() => replace.replace(m, 999)).toThrow(NoSuchTransaction);
    replace.replace(m, bank);
    expect(() => replace.replace(m, ctx.store(-100, 'Other'))).toThrow(AlreadyReplaced);
    expect(() => replace.notSame(bank, m)).toThrow(NotAManualAndBankPair);
  });
});
