import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShareOption } from '@bankapp/shared';
import { InvalidInput, NoCloseToUndo } from '../src/domain-errors';
import {
  checkClose,
  checkOpenMonth,
  checkUndoClose,
  replaySettlement,
  type PeriodRow,
  type ReplayInput,
  type ReplaySetting,
  type ReplayTransaction,
} from '../src/settlement/replay';

const TODAY = '2026-11-15';

let counter = 0;
/** A purchase on the 50/50 card, paid by the owner. */
function tx(
  date: string,
  amount: number,
  values: Partial<ReplayTransaction> = {},
): ReplayTransaction {
  counter += 1;
  return {
    id: counter,
    date,
    description: `Köp ${counter}`,
    amount,
    paidBy: 'owner',
    status: 'booked',
    shareOption: 'half' as ShareOption,
    sharePercent: 50,
    kind: 'expense',
    categoryName: 'Mat',
    subcategoryName: 'Livsmedel',
    accountName: 'Coop Mastercard',
    icon: null,
    colour: null,
    ...values,
  };
}
const settlement = (amount: number, date: string, values: Partial<ReplayTransaction> = {}) =>
  tx(date, amount, {
    kind: 'transfer',
    categoryName: 'Överföring',
    subcategoryName: 'Avräkning delade utgifter',
    shareOption: 'me',
    sharePercent: 100,
    accountName: 'Lönekonto',
    ...values,
  });
const setting = (id: number, amount: number, asOf: string): ReplaySetting => ({ id, amount, asOf });
const open = (month = '2026-11'): PeriodRow => ({ month, closedThrough: null });

function replay(input: Partial<ReplayInput>) {
  return replaySettlement({ settings: [], transactions: [], periods: [], today: TODAY, ...input });
}
const balanceOf = (input: Partial<ReplayInput>) => replay(input).balance;

describe('replaySettlement: balance settings', () => {
  it('has no balance before the first setting', () => {
    expect(replay({ transactions: [tx('2026-11-10', -1000)] })).toEqual({
      balance: null,
      periods: [],
      balanceSettings: [],
    });
  });

  it.each([
    {
      name: 'a setting made later wins even when its day is earlier',
      settings: [setting(1, 5000, '2026-11-15'), setting(2, 4000, '2026-11-10')],
      transactions: [tx('2026-11-12', -1000)],
      balance: 4500,
      history: [4000, 5000],
    },
    {
      name: 'the latest setting is the balance, earlier ones stay in the history',
      settings: [setting(1, 100, '2026-11-01'), setting(2, 50, '2026-11-10')],
      transactions: [tx('2026-11-05', -1000)],
      balance: 50,
      history: [50, 100],
    },
  ])('$name', ({ settings, transactions, balance, history }) => {
    const result = replay({ settings, transactions });
    expect(result.balance).toBe(balance);
    expect(result.balanceSettings.map((s) => s.amount)).toEqual(history);
  });

  it('counts only transactions dated on or after the setting’s day', () => {
    expect(
      balanceOf({
        settings: [setting(1, 100, '2026-11-01')],
        transactions: [tx('2026-10-31', -1000), tx('2026-11-01', -1000)],
      }),
    ).toBe(600);
  });
});

describe('replaySettlement: what moves the balance', () => {
  const from = [setting(1, 0, '2026-11-01')];

  it.each([
    { name: 'the partner’s part of a 50/50 purchase', t: tx('2026-11-10', -1000), balance: 500 },
    {
      name: 'minus the partner’s part of a refund or income',
      t: tx('2026-11-02', 200),
      balance: -100,
    },
    {
      name: 'the owner’s part of a purchase the partner paid, as a debt',
      t: tx('2026-11-02', -1000, { paidBy: 'partner' }),
      balance: -500,
    },
    {
      name: 'not a not-shared transaction',
      t: tx('2026-11-02', -1000, { shareOption: 'me', sharePercent: 100 }),
      balance: 0,
    },
    {
      name: 'a not-shared transaction paid by the partner, whole',
      t: tx('2026-11-02', -1000, { shareOption: 'me', sharePercent: 100, paidBy: 'partner' }),
      balance: -1000,
    },
    {
      name: 'a partner-share purchase in full',
      t: tx('2026-11-02', -1000, { shareOption: 'partner', sharePercent: 0 }),
      balance: 1000,
    },
    {
      name: 'not a card payment, which is a transfer',
      t: tx('2026-11-12', 1000, { kind: 'transfer', subcategoryName: 'Kortbetalning' }),
      balance: 0,
    },
    {
      name: 'an uncategorised transaction',
      t: tx('2026-11-02', -100, { kind: null, categoryName: null, subcategoryName: null }),
      balance: 50,
    },
    {
      name: 'a pending transaction',
      t: tx('2026-11-03', -300, { status: 'pending' }),
      balance: 150,
    },
    {
      name: 'a settlement, lowering it, booked or pending',
      t: settlement(300, '2026-11-05', { status: 'pending' }),
      balance: -300,
    },
    {
      name: 'the owner paying the partner, raising it',
      t: settlement(-200, '2026-11-05'),
      balance: 200,
    },
  ])('$name', ({ t, balance }) => {
    expect(balanceOf({ settings: from, transactions: [t] })).toBe(balance);
  });

  it('lets a settlement leave the balance negative', () => {
    expect(
      balanceOf({
        settings: [setting(1, 100, '2026-11-01')],
        transactions: [settlement(400, '2026-11-05')],
      }),
    ).toBe(-300);
  });

  it('rounds to whole öre', () => {
    expect(balanceOf({ settings: from, transactions: [tx('2026-11-02', -10.05)] })).toBe(5.02);
  });

  it('names a manual transaction Manuell and keeps icon and colour', () => {
    const { periods } = replay({
      settings: from,
      transactions: [
        tx('2026-11-02', -100, {
          accountName: null,
          icon: 'car',
          colour: 'green',
        }),
      ],
    });
    expect(periods[0]?.items[0]).toMatchObject({
      accountName: 'Manuell',
      icon: 'car',
      colour: 'green',
    });
  });
});

describe('replaySettlement: periods', () => {
  const rows = (...r: [string, string | null][]): PeriodRow[] =>
    r.map(([month, closedThrough]) => ({ month, closedThrough }));
  const summary = (periods: ReturnType<typeof replay>['periods']) =>
    periods.map((p) => [p.month, p.closedThrough, p.carriedIn, p.paid, p.carriedOut]);

  it('acts as one open period named after today’s month when there are no rows', () => {
    const { periods } = replay({ settings: [setting(1, 100, '2026-10-01')] });
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      month: '2026-11',
      closedThrough: null,
      startsOn: null,
      overdue: false,
    });
  });

  it('does not split periods by settlements, which are listed as payments', () => {
    const purchase = tx('2026-11-05', -1000);
    const a = settlement(100, '2026-11-14');
    const b = settlement(200, '2026-11-12');
    const { periods, balance } = replay({
      settings: [setting(1, 0, '2026-11-01')],
      transactions: [purchase, a, b],
      periods: rows(['2026-11', null]),
    });
    expect(balance).toBe(200);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ paid: 300, carriedIn: 0, carriedOut: 200 });
    expect(periods[0]?.payments.map((p) => [p.transactionId, p.date, p.amount])).toEqual([
      [b.id, '2026-11-12', 200],
      [a.id, '2026-11-14', 100],
    ]);
    expect(periods[0]?.items.map((i) => i.transactionId)).toEqual([purchase.id]);
  });

  it('closes a period, newest first, carrying the balance on', () => {
    const first = tx('2026-10-05', -1000);
    const { periods, balance } = replay({
      settings: [setting(1, 100, '2026-10-01')],
      transactions: [first, settlement(550, '2026-10-20'), tx('2026-11-02', -400)],
      periods: rows(['2026-10', '2026-10-20'], ['2026-11', null]),
    });
    expect(balance).toBe(250);
    expect(summary(periods)).toEqual([
      ['2026-11', null, 50, 0, 250],
      ['2026-10', '2026-10-20', 0, 550, 50],
    ]);
    expect(periods[0]?.startsOn).toBe('2026-10-21');
    expect(periods[1]?.startsOn).toBeNull();
    expect(periods[1]?.items).toMatchObject([
      { transactionId: first.id, amount: -1000, share: 'half', partnerPart: 500 },
    ]);
    expect(periods[1]?.balanceSettings).toEqual([{ amount: 100, asOf: '2026-10-01' }]);
  });

  it('keeps two settlements on the closing day in the closed period', () => {
    const { periods } = replay({
      settings: [setting(1, 0, '2026-11-01')],
      transactions: [settlement(100, '2026-11-14'), settlement(100, '2026-11-15')],
      periods: rows(['2026-11', '2026-11-15'], ['2026-12', null]),
    });
    expect(periods[1]).toMatchObject({ month: '2026-11', paid: 200 });
    expect(periods[1]?.payments).toHaveLength(2);
  });

  it('puts transactions after the closing date in the next period', () => {
    const after = tx('2026-11-03', -200);
    const { periods } = replay({
      settings: [setting(1, 0, '2026-10-01')],
      transactions: [settlement(100, '2026-11-02'), after],
      periods: rows(['2026-10', '2026-11-02'], ['2026-11', null]),
    });
    expect(periods[0]?.items.map((i) => i.transactionId)).toEqual([after.id]);
    expect(periods[1]).toMatchObject({ month: '2026-10', closedThrough: '2026-11-02', paid: 100 });
  });

  it('puts a late booking in the closed period without changing what was paid', () => {
    const { periods } = replay({
      settings: [setting(1, 0, '2026-10-01')],
      transactions: [settlement(100, '2026-10-20'), tx('2026-10-10', -200)],
      periods: rows(['2026-10', '2026-10-20'], ['2026-11', null]),
    });
    expect(periods[1]).toMatchObject({ month: '2026-10', paid: 100, carriedOut: 0 });
    expect(periods[1]?.items).toHaveLength(1);
    expect(periods[0]?.carriedIn).toBe(0);
  });

  it('gives the same balance with and without the close', () => {
    const input = {
      settings: [setting(1, 100, '2026-10-01')],
      transactions: [tx('2026-10-05', -1000), settlement(300, '2026-10-20')],
    };
    const open = replay({ ...input, periods: rows(['2026-10', null]) }).balance;
    const closed = replay({
      ...input,
      periods: rows(['2026-10', '2026-10-20'], ['2026-11', null]),
    }).balance;
    expect(open).toBe(300);
    expect(closed).toBe(open);
  });

  it('carries a period with nothing in it', () => {
    const { periods } = replay({
      settings: [setting(1, 70, '2026-08-01')],
      periods: rows(['2026-08', '2026-08-31'], ['2026-09', '2026-09-30'], ['2026-10', null]),
    });
    expect(summary(periods)).toEqual([
      ['2026-10', null, 70, 0, 70],
      ['2026-09', '2026-09-30', 70, 0, 70],
      ['2026-08', '2026-08-31', 0, 0, 70],
    ]);
  });

  it('shows a balance setting in the period where it was made', () => {
    const { periods } = replay({
      settings: [setting(1, 100, '2026-10-01'), setting(2, 700, '2026-11-01')],
      transactions: [settlement(100, '2026-10-05')],
      periods: rows(['2026-11', null]),
    });
    expect(periods[0]?.balanceSettings).toEqual([
      { amount: 100, asOf: '2026-10-01' },
      { amount: 700, asOf: '2026-11-01' },
    ]);
    expect(periods[0]?.carriedOut).toBe(700);
  });

  it.each([
    { today: '2026-11-06', overdue: false },
    { today: '2026-11-07', overdue: true },
    { today: '2026-11-15', overdue: true },
  ])('marks the open October overdue from day 7 and not before: $today', ({ today, overdue }) => {
    const { periods } = replay({
      settings: [setting(1, 0, '2026-09-01')],
      periods: rows(['2026-10', null]),
      today,
    });
    expect(periods[0]?.overdue).toBe(overdue);
  });

  it('is never overdue for the current month, nor for a closed one', () => {
    const { periods } = replay({
      settings: [setting(1, 0, '2026-08-01')],
      periods: rows(['2026-08', '2026-08-31'], ['2026-11', null]),
    });
    expect(periods.map((p) => p.overdue)).toEqual([false, false]);
  });
});

describe('the checks on closing, renaming and undoing', () => {
  const closed = (month: string, closedThrough: string): PeriodRow => ({ month, closedThrough });
  const onlyOpen = [open('2026-10')];
  const afterOneClose = [closed('2026-10', '2026-10-20'), open('2026-11')];

  describe('checkClose', () => {
    it.each([
      {
        name: 'a day in the future',
        periods: onlyOpen,
        request: { closedThrough: '2026-11-16', nextMonth: '2026-11' },
      },
      {
        name: 'a closing date that is no day',
        periods: onlyOpen,
        request: { closedThrough: '2026-13-01', nextMonth: '2026-11' },
      },
      { name: 'a missing closing date', periods: onlyOpen, request: { nextMonth: '2026-11' } },
      {
        name: 'a next month that is a day',
        periods: onlyOpen,
        request: { closedThrough: '2026-10-20', nextMonth: '2026-11-01' },
      },
      {
        name: 'a next month that is no month',
        periods: onlyOpen,
        request: { closedThrough: '2026-10-20', nextMonth: '2026-13' },
      },
      { name: 'no request at all', periods: onlyOpen, request: undefined },
      {
        name: 'a date before the previous close',
        periods: afterOneClose,
        request: { closedThrough: '2026-10-19', nextMonth: '2026-12' },
      },
      {
        name: 'the open month as next month',
        periods: afterOneClose,
        request: { closedThrough: '2026-11-01', nextMonth: '2026-11' },
      },
      {
        name: 'an earlier month as next month',
        periods: afterOneClose,
        request: { closedThrough: '2026-11-01', nextMonth: '2026-10' },
      },
    ])('rejects $name', ({ periods, request }) => {
      expect(() => checkClose(periods, request, TODAY)).toThrow(InvalidInput);
    });

    it.each([
      {
        name: 'today itself',
        periods: onlyOpen,
        request: { closedThrough: '2026-11-15', nextMonth: '2026-11' },
      },
      {
        name: 'the previous closing day again',
        periods: afterOneClose,
        request: { closedThrough: '2026-10-20', nextMonth: '2026-12' },
      },
      {
        name: 'a skipped month',
        periods: afterOneClose,
        request: { closedThrough: '2026-11-01', nextMonth: '2027-02' },
      },
    ])('accepts $name', ({ periods, request }) => {
      expect(checkClose(periods, request, TODAY)).toEqual(request);
    });

    it('measures against the virtual open month when there are no rows', () => {
      expect(() =>
        checkClose([], { closedThrough: '2026-11-01', nextMonth: '2026-11' }, TODAY),
      ).toThrow(InvalidInput);
      expect(checkClose([], { closedThrough: '2026-11-01', nextMonth: '2026-12' }, TODAY)).toEqual({
        closedThrough: '2026-11-01',
        nextMonth: '2026-12',
      });
    });
  });

  describe('checkOpenMonth', () => {
    it.each([
      { name: 'a month that is no string', periods: onlyOpen, month: 202611 },
      { name: 'a month without a leading zero', periods: afterOneClose, month: '2026-9' },
      { name: 'the previous month', periods: afterOneClose, month: '2026-10' },
      { name: 'an earlier month than the previous', periods: afterOneClose, month: '2026-09' },
    ])('rejects $name', ({ periods, month }) => {
      expect(() => checkOpenMonth(periods, month)).toThrow(InvalidInput);
    });

    it.each([
      { name: 'a later month than the previous', periods: afterOneClose, month: '2026-12' },
      { name: 'any month while nothing is closed', periods: onlyOpen, month: '2020-01' },
    ])('accepts $name', ({ periods, month }) => {
      expect(checkOpenMonth(periods, month)).toBe(month);
    });
  });

  describe('checkUndoClose', () => {
    it('needs at least one close', () => {
      expect(() => checkUndoClose([])).toThrow(NoCloseToUndo);
      expect(() => checkUndoClose(onlyOpen)).toThrow(NoCloseToUndo);
    });

    it('lets the latest close be undone', () => {
      expect(() => checkUndoClose(afterOneClose)).not.toThrow();
    });
  });
});

describe('the replay module', () => {
  it('imports no database, clock, filesystem or Nest code', () => {
    const source = readFileSync(join(__dirname, '../src/settlement/replay.ts'), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => /nestjs|drizzle|\/db\/|clock|^node:|reports/.test(i!))).toEqual(
      [],
    );
    expect(imports.length).toBeGreaterThan(0);
  });
});
