import type { INestApplication } from '@nestjs/common';
import type { SavingsResponse } from '@bankapp/shared';
import { createApp } from '../src/app';
import type { AppDatabase } from '../src/db/database';
import { DATABASE } from '../src/db/database.module';
import { accounts, balances, connections, transactions } from '../src/db/schema';
import { FakeEnableBankingClient, api as signedIn, testConfig } from './support';

describe('the savings view', () => {
  let app: INestApplication;
  let db: AppDatabase;

  beforeEach(async () => {
    app = await createApp({
      config: testConfig,
      enableBanking: new FakeEnableBankingClient(),
      database: { inMemory: true },
      now: () => new Date('2026-12-15T12:00:00Z'),
    });
    await app.init();
    db = app.get<AppDatabase>(DATABASE);
  });
  afterEach(() => app.close());

  const api = () => signedIn(app);
  const get = async () => (await api().get('/api/savings').expect(200)).body as SavingsResponse;
  const manual = async (name: string, entries: [string, number, number | null][]) => {
    const created = await api().post('/api/manual-savings-accounts').send({ name }).expect(201);
    for (const [date, balance, netDeposits] of entries) {
      await api()
        .post(`/api/manual-savings-accounts/${created.body.id}/entries`)
        .send({ date, balance, netDeposits })
        .expect(201);
    }
    return created.body.id as number;
  };

  /** A connected savings account, with a balance fetched on each given day and deposits made. */
  function connected(
    fetched: [string, number, string?][],
    deposits: [string, number, string?][] = [],
    over: Partial<typeof accounts.$inferInsert> = {},
  ) {
    db.insert(connections)
      .values({ bankName: 'Swedbank', sessionId: 's', validUntil: new Date('2027-06-01') })
      .run();
    db.insert(accounts)
      .values({
        connectionId: 1,
        identificationHash: 'h',
        uid: 'u',
        name: 'Sparkonto',
        type: 'savings',
        currency: 'SEK',
        savings: true,
        ...over,
      })
      .run();
    for (const [day, amount, type] of fetched) {
      db.insert(balances)
        .values({
          accountId: 1,
          type: type ?? 'CLBD',
          amount,
          currency: 'SEK',
          fetchedAt: new Date(`${day}T10:00:00Z`),
        })
        .run();
    }
    deposits.forEach(([date, amount, description], i) =>
      db
        .insert(transactions)
        .values({
          accountId: 1,
          status: 'booked',
          amount,
          currency: 'SEK',
          date,
          description: description ?? 'Insättning',
          dedupKey: `d${i}`,
          raw: '{}',
          fetchedAt: new Date(`${date}T10:00:00Z`),
        })
        .run(),
    );
  }

  it('is empty without savings accounts', async () => {
    expect(await get()).toEqual({
      accounts: [],
      months: [],
      totals: {
        balance: 0,
        netDeposits: null,
        growth: null,
        growthPercent: null,
        approximate: false,
      },
      reminders: [],
    });
  });

  it('sums a connected account and two ISKs, month by month', async () => {
    connected(
      [
        ['2026-10-30', 1000],
        ['2026-11-29', 1200],
        ['2026-12-14', 1300],
      ],
      [
        ['2026-10-01', 900],
        ['2026-11-10', 100],
        ['2026-11-30', 5, 'Ränta'],
      ],
    );
    await manual('ISK A', [
      ['2026-10-28', 400000, 300000],
      ['2026-11-27', 409500, 305000],
    ]);
    await manual('ISK B', [['2026-11-15', 50000, null]]);
    const view = await get();
    expect(view.accounts.map((a) => [a.key, a.balance, a.netDeposits])).toEqual([
      ['connected-1', 1300, 1100],
      ['manual-1', 409500, 305000],
      ['manual-2', 50000, null],
    ]);
    expect(view.totals).toMatchObject({
      balance: 460800,
      netDeposits: 306100,
      growth: 104500 + 200,
      approximate: false,
    });
    expect(view.totals.growthPercent).toBeCloseTo(34.2, 1);
    expect(view.months.map((m) => [m.month, m.balance, m.netDeposits])).toEqual([
      ['2026-10', 401000, 301000],
      ['2026-11', 460700, 306100],
      ['2026-12', 460800, 306100],
    ]);
    expect(view.months[1]!.accounts.map((a) => [a.key, a.balance])).toEqual([
      ['connected-1', 1200],
      ['manual-1', 409500],
      ['manual-2', 50000],
    ]);
  });

  it('measures a connected account from its first sync, whatever happened before', async () => {
    // Only withdrawals are in the fetched history: the deposits behind the balance are unknown.
    connected(
      [
        ['2026-11-01', 50000],
        ['2026-12-14', 49000],
      ],
      [
        ['2026-10-10', -2000, 'Uttag'],
        ['2026-11-20', -1500, 'Uttag'],
        ['2026-12-01', 400, 'Insättning'],
      ],
    );
    const [saving] = (await get()).accounts;
    expect(saving).toMatchObject({ balance: 49000, netDeposits: 48900, growth: 100 });
  });

  it('carries the last known value forward and uses the latest value this month', async () => {
    await manual('ISK', [
      ['2026-09-20', 100, 100],
      ['2026-12-02', 130, 100],
    ]);
    const view = await get();
    expect(view.months.map((m) => [m.month, m.balance])).toEqual([
      ['2026-09', 100],
      ['2026-10', 100],
      ['2026-11', 100],
      ['2026-12', 130],
    ]);
    expect(view.months[3]).toMatchObject({ growth: 30, netDeposits: 100 });
    expect(view.months[2]).toMatchObject({ growth: 0 });
  });

  it('uses the preferred balance type of the last fetch of the month', async () => {
    connected(
      [
        ['2026-11-10', 50, 'CLBD'],
        ['2026-11-20', 70, 'ITAV'],
        ['2026-11-20', 60, 'CLBD'],
      ],
      [],
    );
    const view = await get();
    expect(view.months.find((m) => m.month === '2026-11')!.balance).toBe(60);
  });

  it('counts a closed ISK as 0 from its closing month, keeping its earlier history', async () => {
    const id = await manual('Gammal ISK', [
      ['2026-09-10', 1000, 800],
      ['2026-10-10', 1100, 800],
    ]);
    await api()
      .post(`/api/manual-savings-accounts/${id}/close`)
      .send({ date: '2026-11-05' })
      .expect(201);
    const view = await get();
    expect(view.months.map((m) => [m.month, m.balance, m.netDeposits])).toEqual([
      ['2026-09', 1000, 800],
      ['2026-10', 1100, 800],
      ['2026-11', 0, 0],
      ['2026-12', 0, 0],
    ]);
    expect(view.accounts[0]).toMatchObject({
      closedOn: '2026-11-05',
      balance: 0,
      netDeposits: null,
    });
    expect(view.totals.balance).toBe(0);
  });

  it('counts a connected account of a removed bank as 0 from the day it was removed', async () => {
    connected([['2026-10-30', 500]], [], {});
    db.update(connections)
      .set({ removedAt: new Date('2026-11-02T00:00:00Z') })
      .run();
    const view = await get();
    expect(view.accounts[0]).toMatchObject({ closedOn: '2026-11-02', balance: 0 });
    expect(view.months.at(-1)).toMatchObject({ month: '2026-12', balance: 0 });
    expect(view.totals.balance).toBe(0);
  });

  it('counts an account with balance only in the total balance, not in deposits or growth', async () => {
    await manual('ISK', [['2026-12-01', 1000, 800]]);
    await manual('Buffert', [['2026-12-01', 500, null]]);
    const { totals, months } = await get();
    expect(totals).toMatchObject({ balance: 1500, netDeposits: 800, growth: 200 });
    expect(months.at(-1)).toMatchObject({ balance: 1500, netDeposits: 800 });
  });

  it('marks growth as approximate when an entry left net deposits blank', async () => {
    await manual('ISK', [
      ['2026-10-10', 1000, 800],
      ['2026-11-10', 1200, null],
    ]);
    const view = await get();
    expect(view.accounts[0]).toMatchObject({ approximate: true });
    expect(view.totals.approximate).toBe(true);
    expect(view.months.find((m) => m.month === '2026-11')!.approximate).toBe(true);
    expect(view.months.find((m) => m.month === '2026-10')!.approximate).toBe(false);
  });

  it('ignores accounts that are not marked as savings accounts', async () => {
    connected([['2026-11-10', 50]], [], { savings: false });
    expect((await get()).accounts).toEqual([]);
  });

  describe('the reminder', () => {
    it('names an open manual account with no entry in the month that has just ended', async () => {
      await manual('Avanza ISK', [['2026-10-28', 100, null]]);
      expect((await get()).reminders).toEqual([
        { key: 'manual-1', name: 'Avanza ISK', month: '2026-11' },
      ]);
    });

    it('goes away with an entry for that month or later', async () => {
      await manual('A', [['2026-11-02', 100, null]]);
      await manual('B', [['2026-12-02', 100, null]]);
      expect((await get()).reminders).toEqual([]);
    });

    it('skips closed accounts and accounts without entries', async () => {
      const id = await manual('Stängd', [['2026-09-02', 100, null]]);
      await api().post(`/api/manual-savings-accounts/${id}/close`).send({}).expect(201);
      await api().post('/api/manual-savings-accounts').send({ name: 'Ny' }).expect(201);
      expect((await get()).reminders).toEqual([]);
    });
  });
});
