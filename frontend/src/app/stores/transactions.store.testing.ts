import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { type HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Transaction, TransactionsResponse } from '@bankapp/shared';
import { EMPTY_FILTERS, type TransactionFilters } from '../pages/transactions/transaction-filters';
import {
  TransactionsStore,
  type TransactionListRead,
  type TransactionListRequest,
} from './transactions.store';

export const row = (id: number, category: Transaction['category'] = null): Transaction =>
  ({ id, category }) as Transaction;

export const page = (
  transactions: Transaction[],
  nextCursor: string | null = null,
): TransactionsResponse => ({ transactions, nextCursor, count: transactions.length, sum: null });

/** Asks the store for the list the way a page does, in its own injection context. */
export function openList(request: TransactionListRequest | undefined): {
  read: TransactionListRead;
  request: ReturnType<typeof signal<TransactionListRequest | undefined>>;
  /** Ends the read, as leaving the page does. */
  close: () => void;
} {
  const requested = signal(request);
  const owner = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
  const read = runInInjectionContext(owner, () =>
    TestBed.inject(TransactionsStore).list(requested),
  );
  TestBed.tick();
  return { read, request: requested, close: () => owner.destroy() };
}

/** The owner loads the list and leaves it, so the store keeps it for the way back. */
export function leaveList(
  http: HttpTestingController,
  rows: Transaction[] = [row(1)],
  filters: TransactionFilters = EMPTY_FILTERS,
  cursor: string | null = null,
): void {
  const { close } = openList({ filters, restore: false });
  http.expectOne((r) => r.url === '/api/transactions').flush(page(rows, cursor));
  close();
}

/** Comes back with the back button; true when the store showed the list as it was left. */
export function comesBackToKeptList(
  http: HttpTestingController,
  filters: TransactionFilters = EMPTY_FILTERS,
): boolean {
  const { read, close } = openList({ filters, restore: true });
  const fetched = http.match((r) => r.url === '/api/transactions');
  fetched.forEach((r) => r.flush(page([])));
  const restored = fetched.length === 0 && read.status() === 'ready';
  close();
  return restored;
}
