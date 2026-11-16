import { Review, REVIEW_FROM } from '../src/transactions/review';
import { moduleApp } from './transaction-modules';

describe('the review module', () => {
  let ctx: Awaited<ReturnType<typeof moduleApp>>;
  let review: Review;

  beforeEach(async () => {
    ctx = await moduleApp();
    review = ctx.app.get(Review);
  });
  afterEach(() => ctx.app.close());

  it('lists unconfirmed transactions from the review start, newest first, and counts them', () => {
    const older = ctx.store(-1, 'Old', { date: '2026-11-02' });
    const newer = ctx.store(-1, 'New', { date: '2026-12-02', subcategoryId: ctx.subcategory });
    ctx.store(-1, 'Before', { date: '2026-10-31' });
    ctx.store(-1, 'Confirmed', { categoryConfirmed: true, subcategoryId: ctx.subcategory });
    expect(REVIEW_FROM).toBe('2026-11-01');
    expect(review.list().transactions.map((t) => t.id)).toEqual([newer, older]);
    expect(review.count()).toBe(2);
    expect(review.list().count).toBe(2);
  });

  it('leaves out refunds and offset purchases with a category, which follow each other', () => {
    const purchase = ctx.store(-100, 'Buy', { subcategoryId: ctx.subcategory });
    ctx.store(50, 'Refund', {
      offsetsTransactionId: purchase,
      subcategoryId: ctx.subcategory,
      categoryConfirmed: true,
    });
    expect(review.count()).toBe(0);
  });

  it('counts suggested replacements too', () => {
    ctx.store(-100, 'Kaffe', {
      accountId: null,
      paidBy: 'owner',
      subcategoryId: ctx.subcategory,
      categoryConfirmed: true,
    });
    ctx.store(-100, 'Kaffe', { categoryConfirmed: true, subcategoryId: ctx.subcategory });
    expect(review.list().replacements).toHaveLength(1);
    expect(review.count()).toBe(1);
  });
});
