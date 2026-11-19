import { change, stateOn, type Entry } from '../src/manual-savings/figures';

const ISK: Entry[] = [
  { date: '2026-10-28', balance: 400000, netDeposits: 300000 },
  { date: '2026-11-27', balance: 409500, netDeposits: 305000 },
];

describe('the figures of a manual savings account', () => {
  it('carries the latest entry on or before a day forward', () => {
    expect(stateOn(ISK, null, '2026-10-27')).toBeNull();
    expect(stateOn(ISK, null, '2026-10-28')).toMatchObject({
      balance: 400000,
      netDeposits: 300000,
    });
    expect(stateOn(ISK, null, '2026-11-26')).toMatchObject({ balance: 400000 });
    expect(stateOn(ISK, null, '2026-12-31')).toMatchObject({
      balance: 409500,
      netDeposits: 305000,
    });
  });

  it('gives November deposits of 5 000 and growth of 4 500, and 104 500 since opening', () => {
    expect(change(ISK, null, '2026-10-31', '2026-11-30')).toEqual({
      deposits: 5000,
      growth: 4500,
      approximate: false,
    });
    const now = stateOn(ISK, null, '2026-11-30')!;
    expect(now.balance - now.netDeposits!).toBe(104500);
  });

  it('measures a stretch that starts before the account existed from its first entry', () => {
    expect(change(ISK, null, '2026-09-30', '2026-11-30')).toMatchObject({
      deposits: 5000,
      growth: 4500,
    });
  });

  it('carries net deposits forward when left blank and marks the growth approximate', () => {
    const entries: Entry[] = [...ISK, { date: '2026-12-10', balance: 412000, netDeposits: null }];
    expect(stateOn(entries, null, '2026-12-10')).toMatchObject({
      balance: 412000,
      netDeposits: 305000,
    });
    expect(change(entries, null, '2026-11-30', '2026-12-31')).toEqual({
      deposits: 0,
      growth: 2500,
      approximate: true,
    });
  });

  it('has balance only when no entry has net deposits', () => {
    const entries: Entry[] = [
      { date: '2026-11-01', balance: 1000, netDeposits: null },
      { date: '2026-12-01', balance: 1200, netDeposits: null },
    ];
    expect(stateOn(entries, null, '2026-12-05')).toMatchObject({
      balance: 1200,
      netDeposits: null,
    });
    expect(change(entries, null, '2026-11-01', '2026-12-05')).toBeNull();
  });

  it('counts as 0 from the day it closed, keeping the history', () => {
    expect(stateOn(ISK, '2026-12-15', '2026-12-14')).toMatchObject({ balance: 409500 });
    expect(stateOn(ISK, '2026-12-15', '2026-12-15')).toMatchObject({
      balance: 0,
      netDeposits: 0,
      closed: true,
    });
  });
});
