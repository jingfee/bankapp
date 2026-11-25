import { TestBed } from '@angular/core/testing';
import { ALL_READS, type Fact, Invalidation, type Read } from './invalidation';

// ADR 0015's table, written out again so that changing the map means changing the decision.
const TRANSACTIONS: Read[] = [
  'transactionList',
  'listed',
  'review',
  'transactionDetails',
  'overview',
  'settlement',
  'mortgageFigures',
];

const table: [Fact, Read[]][] = [
  ['transactions', TRANSACTIONS],
  ['accounts', ['accounts', 'savings', ...TRANSACTIONS]],
  [
    'shares',
    ['shares', 'transactionList', 'listed', 'transactionDetails', 'overview', 'settlement'],
  ],
  ['banks', [...ALL_READS]],
  ['settlement', ['settlement', 'overview']],
  ['mortgage', ['mortgage', 'mortgageFigures']],
  ['savings', ['savings', 'manualSavings']],
];

describe('Invalidation', () => {
  it.each(table)('%s refreshes exactly the reads in ADR 0015', (fact, expected) => {
    const invalidation = TestBed.inject(Invalidation);
    const refreshed: Read[] = [];
    for (const read of ALL_READS) invalidation.onRead(read, () => refreshed.push(read));
    const before = new Map(ALL_READS.map((read) => [read, invalidation.version(read)()]));

    invalidation.fire(fact);

    expect(refreshed.sort()).toEqual([...expected].sort());
    const bumped = ALL_READS.filter((read) => invalidation.version(read)() !== before.get(read));
    expect(bumped.sort()).toEqual([...expected].sort());
  });

  it('refreshAll refreshes every read, listeners and versions alike', () => {
    const invalidation = TestBed.inject(Invalidation);
    const refreshed: Read[] = [];
    for (const read of ALL_READS) invalidation.onRead(read, () => refreshed.push(read));
    const before = ALL_READS.map((read) => invalidation.version(read)());

    invalidation.refreshAll();

    expect(refreshed.sort()).toEqual([...ALL_READS].sort());
    expect(ALL_READS.map((read) => invalidation.version(read)())).toEqual(before.map((n) => n + 1));
  });

  it('refreshes every read for banks', () => {
    expect(table.find(([fact]) => fact === 'banks')![1]).toHaveLength(ALL_READS.length);
  });
});
