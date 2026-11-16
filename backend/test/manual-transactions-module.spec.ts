import { eq } from 'drizzle-orm';
import { transactions } from '../src/db/schema';
import {
  InvalidInput,
  NoHouseholdRatio,
  NoSuchTransaction,
  NotManual,
  UnknownSubcategory,
} from '../src/domain-errors';
import { ManualTransactions } from '../src/transactions/manual-transactions';
import { moduleApp } from './transaction-modules';

describe('the manual transactions module', () => {
  let ctx: Awaited<ReturnType<typeof moduleApp>>;
  let manual: ManualTransactions;

  beforeEach(async () => {
    ctx = await moduleApp();
    manual = ctx.app.get(ManualTransactions);
  });
  afterEach(() => ctx.app.close());

  const valid = () => ({ description: 'Kaffe', amount: -45.123, subcategoryId: ctx.subcategory });

  it('adds a confirmed, booked transaction dated today with the amount rounded to öre', () => {
    const added = manual.add({ ...valid(), description: '  Kaffe ' });
    expect(added).toMatchObject({
      description: 'Kaffe',
      amount: { amount: -45.12, currency: 'SEK' },
      date: '2026-12-15',
      status: 'booked',
      account: null,
      paidBy: 'owner',
    });
    expect(added.category?.confirmed).toBe(true);
  });

  it.each([
    ['an empty description', { description: ' ' }],
    ['a zero amount', { amount: 0 }],
    ['a text amount', { amount: '5' }],
    ['a missing subcategory', { subcategoryId: undefined }],
    ['a bad date', { date: '2026-02-30' }],
    ['an unknown share', { share: 'all' }],
    ['an unknown payer', { paidBy: 'bank' }],
  ])('validates its own input: %s', (_, change) => {
    expect(() => manual.add({ ...valid(), ...change })).toThrow(InvalidInput);
  });

  it('needs an existing subcategory and, for Hushåll, a household ratio', () => {
    expect(() => manual.add({ ...valid(), subcategoryId: 99999 })).toThrow(UnknownSubcategory);
    expect(() => manual.add({ ...valid(), share: 'household' })).toThrow(NoHouseholdRatio);
  });

  it('edits only manual transactions and unlinks refunds when the direction changes', () => {
    const { id } = manual.add(valid());
    const refund = ctx.store(20, 'Refund', { offsetsTransactionId: id });
    const edited = manual.edit(id, { ...valid(), amount: 30, subcategoryId: ctx.otherSubcategory });
    expect(edited.amount.amount).toBe(30);
    expect(
      ctx.db.select().from(transactions).where(eq(transactions.id, refund)).get()
        ?.offsetsTransactionId,
    ).toBeNull();
    expect(() => manual.edit(ctx.store(-1, 'Bank'), valid())).toThrow(NotManual);
    expect(() => manual.edit(999, valid())).toThrow(NoSuchTransaction);
  });

  it('deletes only manual transactions, leaving refunds ordinary', () => {
    const { id } = manual.add(valid());
    const refund = ctx.store(20, 'Refund', { offsetsTransactionId: id });
    manual.delete(id);
    expect(ctx.db.select().from(transactions).where(eq(transactions.id, id)).get()).toBeUndefined();
    expect(
      ctx.db.select().from(transactions).where(eq(transactions.id, refund)).get()
        ?.offsetsTransactionId,
    ).toBeNull();
    expect(() => manual.delete(ctx.store(-1, 'Bank'))).toThrow(NotManual);
    expect(() => manual.delete(id)).toThrow(NoSuchTransaction);
  });
});
