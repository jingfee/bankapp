import { Injectable, type Signal, signal } from '@angular/core';

/** What a mutation announces it changed (ADR 0015). */
export type Fact =
  'transactions' | 'accounts' | 'shares' | 'banks' | 'settlement' | 'mortgage' | 'savings';

/** A read that can go stale. Categories are not here: they stay cached for the whole session. */
export type Read =
  | 'transactionList'
  | 'listed'
  | 'review'
  | 'transactionDetails'
  | 'overview'
  | 'settlement'
  | 'mortgage'
  | 'mortgageFigures'
  | 'accounts'
  | 'savings'
  | 'manualSavings'
  | 'banks'
  | 'shares';

const TRANSACTIONS: readonly Read[] = [
  'transactionList',
  'listed',
  'review',
  'transactionDetails',
  'overview',
  'settlement',
  'mortgageFigures',
];

export const ALL_READS: readonly Read[] = [
  ...TRANSACTIONS,
  'mortgage',
  'accounts',
  'savings',
  'manualSavings',
  'banks',
  'shares',
];

/** Which reads each fact refreshes. The table in ADR 0015 is the specification. */
export const INVALIDATION_MAP: Readonly<Record<Fact, readonly Read[]>> = {
  transactions: TRANSACTIONS,
  accounts: ['accounts', 'savings', ...TRANSACTIONS],
  shares: ['shares', 'transactionList', 'listed', 'transactionDetails', 'overview', 'settlement'],
  banks: ALL_READS,
  settlement: ['settlement', 'overview'],
  mortgage: ['mortgage', 'mortgageFigures'],
  savings: ['savings', 'manualSavings'],
};

/**
 * Turns facts into refreshed reads. A read either listens with `onRead`, or depends on its
 * `version` signal so it is fetched again when the version changes.
 */
@Injectable({ providedIn: 'root' })
export class Invalidation {
  private readonly versions = new Map<Read, ReturnType<typeof signal<number>>>(
    ALL_READS.map((read) => [read, signal(0)]),
  );
  private readonly listeners = new Map<Read, (() => void)[]>();

  /** Changes whenever a fact affecting the read is fired. */
  version(read: Read): Signal<number> {
    return this.versions.get(read)!.asReadonly();
  }

  /** Calls `refresh` whenever a fact affecting the read is fired. */
  onRead(read: Read, refresh: () => void): void {
    this.listeners.set(read, [...(this.listeners.get(read) ?? []), refresh]);
  }

  /** Refreshes every read, for when the app is back from being offline. */
  refreshAll(): void {
    for (const read of ALL_READS) {
      this.versions.get(read)!.update((n) => n + 1);
      this.listeners.get(read)?.forEach((refresh) => refresh());
    }
  }

  fire(fact: Fact): void {
    for (const read of INVALIDATION_MAP[fact]) {
      this.versions.get(read)!.update((n) => n + 1);
      this.listeners.get(read)?.forEach((refresh) => refresh());
    }
  }
}
