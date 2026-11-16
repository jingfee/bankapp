import { eq } from 'drizzle-orm';
import { Categorising } from '../src/categories/guessing/categorising';
import { transactions } from '../src/db/schema';
import { FollowsPurchase, NoSuchTransaction, UnknownSubcategory } from '../src/domain-errors';
import { moduleApp } from './transaction-modules';

describe('categorising', () => {
  let ctx: Awaited<ReturnType<typeof moduleApp>>;
  let categorising: Categorising;

  beforeEach(async () => {
    ctx = await moduleApp();
    categorising = ctx.app.get(Categorising);
  });
  afterEach(() => ctx.app.close());

  const row = (id: number) =>
    ctx.db.select().from(transactions).where(eq(transactions.id, id)).get()!;

  it('confirms the owner’s choice and guesses similar unconfirmed transactions anew', () => {
    const chosen = ctx.store(-10, 'ICA Maxi 123');
    const similar = ctx.store(-20, 'ICA MAXI 456', { subcategoryId: ctx.otherSubcategory });
    const unrelated = ctx.store(-5, 'Kiosk');
    const result = categorising.set(chosen, ctx.subcategory);
    expect(result.updatedSimilar).toBe(1);
    expect(result.category?.subcategory.id).toBe(ctx.subcategory);
    expect(row(chosen).categoryConfirmed).toBe(true);
    expect(row(similar)).toMatchObject({
      subcategoryId: ctx.subcategory,
      categoryConfirmed: false,
    });
    expect(row(unrelated).subcategoryId).toBeNull();
  });

  it('keeps refunds on their purchase’s category whenever the purchase changes', () => {
    const purchase = ctx.store(-100, 'Buy');
    const refund = ctx.store(50, 'Refund', { offsetsTransactionId: purchase });
    categorising.set(purchase, ctx.subcategory);
    expect(row(refund)).toMatchObject({ subcategoryId: ctx.subcategory, categoryConfirmed: true });
    categorising.set(purchase, null);
    expect(row(refund)).toMatchObject({ subcategoryId: null, categoryConfirmed: false });
  });

  it('refuses a refund, a missing transaction and a missing subcategory', () => {
    const purchase = ctx.store(-100, 'Buy');
    const refund = ctx.store(50, 'Refund', { offsetsTransactionId: purchase });
    expect(() => categorising.set(refund, ctx.subcategory)).toThrow(FollowsPurchase);
    expect(() => categorising.set(999, ctx.subcategory)).toThrow(NoSuchTransaction);
    expect(() => categorising.set(purchase, 99999)).toThrow(UnknownSubcategory);
  });
});
