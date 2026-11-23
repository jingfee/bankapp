import { HttpErrorResponse } from '@angular/common/http';
import { type Signal, computed, effect, signal } from '@angular/core';
import type {
  ManualTransactionRequest,
  Money,
  OffsetCandidatesResponse,
  ReplacementRequest,
  ShareOption,
  Transaction,
  TransactionCategoryResponse,
  TransactionDetails,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';
import type { ParamRead } from './kept';
import { Recorder } from './recorder';
import {
  TransactionsStore,
  type TransactionListRead,
  type TransactionListRequest,
} from './transactions.store';

export class FakeTransactionsStore extends TransactionsStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  /** What the list shows; a test sets these to say what the store has loaded. */
  readonly listed = {
    transactions: signal<Transaction[]>([]),
    count: signal(0),
    sum: signal<Money | null>(null),
    hasMore: signal(false),
    status: signal<'loading' | 'ready' | 'failed'>('loading'),
    loadingMore: signal(false),
    moreFailed: signal(false),
  };
  /** Every request the list was asked for, in order. */
  readonly listRequests: TransactionListRequest[] = [];
  /** What each transaction's details answer, keyed by id: details, 'error', or 'gone' (404). */
  readonly detailsById = signal<Record<string, TransactionDetails | 'error' | 'gone'>>({});
  /** Every id the details were asked for, in order. */
  readonly detailsRequested: string[] = [];

  list(request: Signal<TransactionListRequest | undefined>): TransactionListRead {
    effect(() => {
      const r = request();
      if (r !== undefined) this.listRequests.push(r);
    });
    return {
      ...this.listed,
      loadMore: () => this.calls.push({ method: 'loadMore', args: [] }),
    };
  }
  details(id: Signal<string | undefined>): ParamRead<TransactionDetails> {
    const answered = computed(() => {
      const key = id();
      if (key === undefined) return undefined;
      if (!this.detailsRequested.includes(key)) this.detailsRequested.push(key);
      return this.detailsById()[key];
    });
    return {
      value: computed(() => {
        const a = answered();
        return a === 'error' || a === 'gone' ? undefined : a;
      }),
      loading: computed(() => id() !== undefined && answered() === undefined),
      failed: computed(() => answered() === 'error' || answered() === 'gone'),
      error: computed(() =>
        answered() === 'gone'
          ? new HttpErrorResponse({ status: 404 })
          : answered() === 'error'
            ? new HttpErrorResponse({ status: 500 })
            : undefined,
      ),
    };
  }
  get(id: string): Observable<TransactionDetails> {
    return this.recorder.reply('get', id);
  }
  offsetCandidates(id: number, search = ''): Observable<OffsetCandidatesResponse> {
    return this.recorder.reply('offsetCandidates', id, search);
  }

  addManual(request: ManualTransactionRequest): Observable<Transaction> {
    return this.recorder.reply('addManual', request);
  }
  editManual(id: number, request: ManualTransactionRequest): Observable<Transaction> {
    return this.recorder.reply('editManual', id, request);
  }
  deleteManual(id: number): Observable<void> {
    return this.recorder.reply('deleteManual', id);
  }
  replace(request: ReplacementRequest): Observable<void> {
    return this.recorder.reply('replace', request);
  }
  notSame(request: ReplacementRequest): Observable<void> {
    return this.recorder.reply('notSame', request);
  }
  setCategory(id: number, subcategoryId: number | null): Observable<TransactionCategoryResponse> {
    return this.recorder.reply('setCategory', id, subcategoryId);
  }
  setOffset(id: number, purchaseId: number | null): Observable<TransactionDetails> {
    return this.recorder.reply('setOffset', id, purchaseId);
  }
  setShare(id: number, share: ShareOption | null): Observable<TransactionDetails> {
    return this.recorder.reply('setShare', id, share);
  }
}
