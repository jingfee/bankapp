import type { EnableBankingTransaction } from '../src/enable-banking/enable-banking-client';
import {
  reconcile,
  type StoredBooked,
  type StoredPending,
  type StoredTransactions,
} from '../src/sync/reconcile';

const TODAY = '2026-11-16';

/** A transaction as the bank returns it: booked on 2026-11-09 at ICA unless overridden. */
function fetched(
  amount: number,
  overrides: Partial<EnableBankingTransaction> = {},
): EnableBankingTransaction {
  return {
    status: 'booked',
    amount,
    currency: 'SEK',
    // A card reservation has no booking date yet; one with a booking date to come is upcoming.
    bookingDate: overrides.status === 'pending' ? null : '2026-11-09',
    valueDate: '2026-11-09',
    transactionDate: null,
    description: 'ICA',
    entryReference: null,
    raw: '{}',
    ...overrides,
  };
}

/** A stored pending row with no decisions of the owner's. */
function pending(
  id: number,
  amount: number,
  overrides: Partial<StoredPending> = {},
): StoredPending {
  return {
    id,
    entryReference: `p${id}`,
    dedupKey: `ref:p${id}`,
    amount,
    currency: 'SEK',
    description: 'ICA',
    transactionDate: null,
    date: '2026-11-08',
    subcategoryId: null,
    categoryConfirmed: false,
    categoryConfirmedAt: null,
    share: null,
    replacesTransactionId: null,
    ...overrides,
  };
}

function booked(id: number, dedupKey: string, overrides: Partial<StoredBooked> = {}): StoredBooked {
  return {
    id,
    dedupKey,
    categoryConfirmed: false,
    share: null,
    replacesTransactionId: null,
    ...overrides,
  };
}

const nothing: StoredTransactions = { pending: [], booked: [] };

describe('reconciling stored transactions with what the bank returns', () => {
  describe('the listing date', () => {
    it.each<[string, Partial<EnableBankingTransaction>, string]>([
      [
        'transaction date first',
        { transactionDate: '2026-11-07', valueDate: '2026-11-08', bookingDate: '2026-11-09' },
        '2026-11-07',
      ],
      ['then value date', { valueDate: '2026-11-08', bookingDate: '2026-11-09' }, '2026-11-08'],
      ['then booking date', { valueDate: null, bookingDate: '2026-11-09' }, '2026-11-09'],
      ['then today', { valueDate: null, bookingDate: null }, TODAY],
    ])('is the %s', (_, overrides, date) => {
      const plan = reconcile(nothing, [fetched(-10, overrides)], TODAY);
      expect(plan.insert.map((row) => row.date)).toEqual([date]);
    });
  });

  describe('dedup keys', () => {
    it.each<[string, EnableBankingTransaction[], string[]]>([
      [
        'are the entry reference when there is one',
        [fetched(-10, { entryReference: 'e1' })],
        ['ref:e1'],
      ],
      [
        'are a fingerprint of booking date, amount and description otherwise',
        [fetched(-10, { transactionDate: '2026-11-07' })],
        ['fp:["2026-11-09",-10,"ICA"]:0'],
      ],
      [
        'count identical booked transactions, not pending ones in between',
        [fetched(-10), fetched(-10, { status: 'pending', description: 'Coop' }), fetched(-10)],
        ['fp:["2026-11-09",-10,"ICA"]:0', 'pending:0:2026-11-09', 'fp:["2026-11-09",-10,"ICA"]:1'],
      ],
    ])('%s', (_, transactions, keys) => {
      expect(reconcile(nothing, transactions, TODAY).insert.map((row) => row.dedupKey)).toEqual(
        keys,
      );
    });
  });

  it('leaves out upcoming transactions but keeps card reservations', () => {
    const plan = reconcile(
      nothing,
      [
        fetched(-500, { status: 'pending', bookingDate: '2026-11-30', description: 'Hyra' }),
        fetched(-35, { status: 'pending', transactionDate: '2026-11-15', description: 'Cafe' }),
      ],
      TODAY,
    );
    expect(plan.insert.map((row) => row.description)).toEqual(['Cafe']);
  });

  describe('a pending transaction and its booked twin', () => {
    // A stored pending row the bank no longer returns, and the booked transaction that arrives.
    it.each<[string, Partial<StoredPending>, EnableBankingTransaction, boolean]>([
      ['with the same description', {}, fetched(-35), true],
      [
        'whatever the case or punctuation',
        { description: 'Foo Bar Store' },
        fetched(-35, { description: 'FOO.BAR STORE' }),
        true,
      ],
      [
        'when booking appends a reference',
        { description: 'lufthansa.com' },
        fetched(-35, { description: 'Lufthansa.com 22041073' }),
        true,
      ],
      ['for a refund reserved with the opposite sign', {}, fetched(35), true],
      ['not for a different amount', {}, fetched(-36), false],
      ['not for another currency', {}, fetched(-35, { currency: 'EUR' }), false],
      [
        'not for a different description',
        { description: 'Coop' },
        fetched(-35, { description: 'ICA' }),
        false,
      ],
      ['not for an empty description', { description: '' }, fetched(-35), false],
    ])('match %s', (_, stored, transaction, twins) => {
      const plan = reconcile(
        { pending: [pending(1, -35, stored)], booked: [] },
        [transaction],
        TODAY,
      );
      if (twins) {
        expect(plan).toEqual({
          remove: [],
          update: [
            {
              id: 1,
              row: expect.objectContaining({ status: 'booked', amount: transaction.amount }),
              newlyBooked: true,
              guess: true,
            },
          ],
          inherit: [],
          insert: [],
        });
      } else {
        expect(plan.remove).toEqual([1]);
        expect(plan.insert).toMatchObject([{ status: 'booked' }]);
      }
    });

    it('drops the bank’s own pending entry when it returns both, one twin each', () => {
      const plan = reconcile(
        nothing,
        [
          fetched(-35, { status: 'pending', description: 'Espresso House' }),
          fetched(-35, { description: 'espresso house ' }),
          fetched(-35, { status: 'pending', description: 'Espresso House' }),
          fetched(-50, { status: 'pending', description: 'Espresso House' }),
        ],
        TODAY,
      );
      expect(plan.insert.map((row) => [row.status, row.amount])).toEqual([
        ['booked', -35],
        ['pending', -35],
        ['pending', -50],
      ]);
    });

    it('updates the stored row in place when the pending entry books, keeping its day', () => {
      const plan = reconcile(
        {
          pending: [
            pending(1, -1762, {
              description: 'lufthansa.com',
              transactionDate: '2026-11-12',
              date: '2026-11-12',
            }),
          ],
          booked: [],
        },
        [
          fetched(-1762, {
            description: 'Lufthansa.com 22041073',
            transactionDate: '2026-11-13',
            bookingDate: '2026-11-16',
            entryReference: 'b1',
          }),
        ],
        TODAY,
      );
      expect(plan.update).toMatchObject([
        {
          id: 1,
          row: {
            status: 'booked',
            dedupKey: 'ref:b1',
            transactionDate: '2026-11-12',
            date: '2026-11-12',
            bookingDate: '2026-11-16',
          },
          newlyBooked: true,
        },
      ]);
    });

    it('updates a stored row the bank still returns as pending, and keeps it', () => {
      const plan = reconcile(
        { pending: [pending(1, -10, { description: 'Cafe' })], booked: [] },
        [fetched(-12, { status: 'pending', description: 'Cafe', entryReference: 'p1' })],
        TODAY,
      );
      expect(plan).toEqual({
        remove: [],
        update: [
          {
            id: 1,
            row: expect.objectContaining({ amount: -12 }),
            newlyBooked: false,
            guess: false,
          },
        ],
        inherit: [],
        insert: [],
      });
    });

    it('replaces a stored pending row without an entry reference on each sync', () => {
      const plan = reconcile(
        {
          pending: [pending(1, -10, { entryReference: null, dedupKey: 'pending:0:2026-11-08' })],
          booked: [],
        },
        [fetched(-10, { status: 'pending' })],
        TODAY,
      );
      expect(plan.remove).toEqual([1]);
      expect(plan.insert).toMatchObject([{ status: 'pending', amount: -10 }]);
    });

    it.each([
      ['cancelled (CNCL)', 'Bokning avbruten'],
      ['rejected (RJCT)', 'Köp nekat'],
    ])('removes a reservation the bank no longer returns because it was %s', (_, description) => {
      // The client leaves out RJCT and CNCL entries, so the reservation is simply gone.
      const plan = reconcile(
        { pending: [pending(1, -99, { description })], booked: [] },
        [fetched(-35)],
        TODAY,
      );
      expect(plan.remove).toEqual([1]);
      expect(plan.update).toEqual([]);
    });
  });

  describe('what the owner decided about a removed pending row', () => {
    const decided = {
      subcategoryId: 7,
      categoryConfirmed: true,
      categoryConfirmedAt: new Date('2026-11-10T12:00:00Z'),
    };

    it('goes with a pending row that is kept in place', () => {
      const plan = reconcile(
        { pending: [pending(1, -35, { ...decided, share: 'me' })], booked: [] },
        [fetched(-35)],
        TODAY,
      );
      expect(plan.update).toMatchObject([{ id: 1, newlyBooked: true, guess: false }]);
      expect(plan.update[0]!.row).not.toHaveProperty('subcategoryId');
      expect(plan.inherit).toEqual([]);
    });

    it('goes to its newly inserted twin when the row cannot be kept', () => {
      const plan = reconcile(
        {
          pending: [
            pending(1, -35, {
              ...decided,
              entryReference: null,
              dedupKey: 'pending:0:2026-11-08',
              share: 'me',
              replacesTransactionId: 3,
            }),
          ],
          booked: [],
        },
        [fetched(-35)],
        TODAY,
      );
      expect(plan.remove).toEqual([1]);
      expect(plan.insert).toEqual([
        expect.objectContaining({
          status: 'booked',
          ...decided,
          share: 'me',
          replacesTransactionId: 3,
        }),
      ]);
    });

    it('goes to an already stored booked twin, except what the owner decided about that', () => {
      const plan = reconcile(
        {
          pending: [pending(1, -35, { ...decided, share: 'me', replacesTransactionId: 3 })],
          booked: [booked(2, 'ref:b1', { share: 'half' })],
        },
        [fetched(-35, { entryReference: 'b1' })],
        TODAY,
      );
      expect(plan).toEqual({
        remove: [1],
        update: [],
        inherit: [{ id: 2, inheritance: { ...decided, replacesTransactionId: 3 } }],
        insert: [],
      });
    });

    it('does not override a category the owner confirmed on the stored booked twin', () => {
      const plan = reconcile(
        {
          pending: [pending(1, -35, decided)],
          booked: [booked(2, 'ref:b1', { categoryConfirmed: true })],
        },
        [fetched(-35, { entryReference: 'b1' })],
        TODAY,
      );
      expect(plan).toEqual({ remove: [1], update: [], inherit: [], insert: [] });
    });

    it('is only a share when that is all the owner set, so a guessed category stays', () => {
      const plan = reconcile(
        {
          pending: [pending(1, -35, { share: 'me' })],
          booked: [booked(2, 'ref:b1')],
        },
        [fetched(-35, { entryReference: 'b1' })],
        TODAY,
      );
      expect(plan.inherit).toEqual([{ id: 2, inheritance: { share: 'me' } }]);
    });

    it('includes a removed category, so the twin is not guessed either', () => {
      const plan = reconcile(
        {
          pending: [
            pending(1, -35, {
              categoryConfirmed: true,
              entryReference: null,
              dedupKey: 'pending:0:x',
            }),
          ],
          booked: [],
        },
        [fetched(-35)],
        TODAY,
      );
      expect(plan.insert).toMatchObject([{ subcategoryId: null, categoryConfirmed: true }]);
    });

    it('is lost with a dropped pending replacer, so the manual transaction comes back', () => {
      const plan = reconcile(
        {
          pending: [pending(1, -245, { description: 'Coop', replacesTransactionId: 3 })],
          booked: [],
        },
        [fetched(-35, { description: 'ICA' })],
        TODAY,
      );
      expect(plan.remove).toEqual([1]);
      expect(plan.update).toEqual([]);
      expect(plan.inherit).toEqual([]);
      expect(plan.insert).toEqual([
        expect.not.objectContaining({ replacesTransactionId: expect.anything() }),
      ]);
    });
  });

  it('does not insert a booked transaction that is already stored', () => {
    const plan = reconcile(
      { pending: [], booked: [booked(1, 'ref:e1')] },
      [fetched(-10, { entryReference: 'e1' }), fetched(-20, { entryReference: 'e2' })],
      TODAY,
    );
    expect(plan).toEqual({
      remove: [],
      update: [],
      inherit: [],
      insert: [expect.objectContaining({ dedupKey: 'ref:e2', status: 'booked', amount: -20 })],
    });
  });
});
