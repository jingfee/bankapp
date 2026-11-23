import { HttpClient } from '@angular/common/http';
import {
  DestroyRef,
  Injectable,
  type Signal,
  computed,
  effect,
  forwardRef,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type {
  ManualTransactionRequest,
  Money,
  OffsetCandidatesResponse,
  ReplacementRequest,
  SetTransactionCategoryRequest,
  SetTransactionOffsetRequest,
  SetTransactionShareRequest,
  ShareOption,
  Transaction,
  TransactionCategoryResponse,
  TransactionDetails,
  TransactionsResponse,
} from '@bankapp/shared';
import { type Observable, type Subscription, tap } from 'rxjs';
import {
  type TransactionFilters,
  filtersKey,
  filtersToParams,
} from '../pages/transactions/transaction-filters';
import { TransactionsService } from '../transactions.service';
import { Invalidation } from './invalidation';
import { type ParamRead, paramRead } from './kept';

/** What the transaction list is read for. */
export interface TransactionListRequest {
  filters: TransactionFilters;
  /**
   * The owner came back with the browser's back button: show the list as it was left, if it
   * was left with these filters and no fact has dropped it since, instead of loading afresh.
   */
  restore: boolean;
}

/** The transaction list a page shows: the first page, then more as the owner asks for them. */
export interface TransactionListRead {
  /** The pages loaded so far, newest first. */
  readonly transactions: Signal<Transaction[]>;
  /** How many transactions match the filters, loaded or not. */
  readonly count: Signal<number>;
  /** What they add up to; null when there is nothing to add up. */
  readonly sum: Signal<Money | null>;
  /** True when there is a next page. */
  readonly hasMore: Signal<boolean>;
  /** 'loading' only while there is nothing to show yet; a refresh keeps the old rows. */
  readonly status: Signal<'loading' | 'ready' | 'failed'>;
  readonly loadingMore: Signal<boolean>;
  /** True when the next page could not be fetched. */
  readonly moreFailed: Signal<boolean>;
  /** Fetches the next page, unless one is under way. */
  loadMore(): void;
}

/** The part of the list the owner has loaded, kept so going back to it finds it as it was left. */
interface ListedTransactions {
  /** The filters it was loaded for; it is only shown again for the same ones. */
  key: string;
  transactions: Transaction[];
  cursor: string | null;
  count: number;
  sum: Money | null;
}

@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpTransactionsStore) })
export abstract class TransactionsStore {
  /**
   * The transactions of every account, newest first, for the filters in `request`. It follows
   * `request` and is live only for as long as the page that asked: call it where the page is
   * created. It is fetched again when `transactions`, `accounts`, `shares` or `banks` change.
   * Nothing is fetched while `request` is undefined.
   */
  abstract list(request: Signal<TransactionListRequest | undefined>): TransactionListRead;
  /**
   * One transaction in full, for the id in the signal; undefined means nothing is fetched. Its
   * `error` is an `HttpErrorResponse` with status 404 when it no longer exists.
   */
  abstract details(id: Signal<string | undefined>): ParamRead<TransactionDetails>;
  /** One transaction in full, once; errors with a 404 when it no longer exists. */
  abstract get(id: string): Observable<TransactionDetails>;
  /** Purchases a money-in transaction could be offset against: likely ones, or those matching `search`. */
  abstract offsetCandidates(id: number, search?: string): Observable<OffsetCandidatesResponse>;

  /** Adds a manual transaction. */
  abstract addManual(request: ManualTransactionRequest): Observable<Transaction>;
  /** Replaces what the owner entered for a manual transaction. */
  abstract editManual(id: number, request: ManualTransactionRequest): Observable<Transaction>;
  /** Deletes a manual transaction. */
  abstract deleteManual(id: number): Observable<void>;
  /** The bank transaction replaces the manual transaction it is the purchase of. */
  abstract replace(request: ReplacementRequest): Observable<void>;
  /** Says the two are not the same purchase, so they are not suggested again. */
  abstract notSame(request: ReplacementRequest): Observable<void>;
  /** Sets the owner's chosen subcategory as confirmed, or removes it with null. */
  abstract setCategory(
    id: number,
    subcategoryId: number | null,
  ): Observable<TransactionCategoryResponse>;
  /** Offsets (kvittar) a refund against a purchase, or removes the link with null. */
  abstract setOffset(id: number, purchaseId: number | null): Observable<TransactionDetails>;
  /** Sets the transaction's own share, or removes it with null so the inherited one applies. */
  abstract setShare(id: number, share: ShareOption | null): Observable<TransactionDetails>;
}

@Injectable()
export class HttpTransactionsStore extends TransactionsStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);
  // The review and its count still live in the service, which also listens to the map for them.
  private readonly reviews = inject(TransactionsService);
  /** Set by the list; read when the owner comes back to it with the browser's back button. */
  private listed: ListedTransactions | null = null;

  constructor() {
    super();
    this.invalidation.onRead('listed', () => (this.listed = null));
  }

  list(request: Signal<TransactionListRequest | undefined>): TransactionListRead {
    const transactions = signal<Transaction[]>([]);
    const cursor = signal<string | null>(null);
    const count = signal(0);
    const sum = signal<Money | null>(null);
    const status = signal<'loading' | 'ready' | 'failed'>('loading');
    const loadingMore = signal(false);
    const moreFailed = signal(false);
    let current: TransactionListRequest | undefined;
    let firstRequest: Subscription | undefined;
    let moreRequest: Subscription | undefined;

    const show = (page: ListedTransactions) => {
      transactions.set(page.transactions);
      cursor.set(page.cursor);
      count.set(page.count);
      sum.set(page.sum);
      status.set('ready');
    };
    const remember = () => {
      this.listed = {
        key: filtersKey(current!.filters),
        transactions: transactions(),
        cursor: cursor(),
        count: count(),
        sum: sum(),
      };
    };
    const loadFirst = (next: TransactionListRequest) => {
      firstRequest?.unsubscribe();
      // A next page of the previous filters must not be added to this list.
      moreRequest?.unsubscribe();
      loadingMore.set(false);
      moreFailed.set(false);
      if (next.restore && this.listed?.key === filtersKey(next.filters)) {
        show(this.listed);
        return;
      }
      if (transactions().length === 0) status.set('loading');
      firstRequest = this.fetch(next.filters).subscribe({
        next: (page) => {
          show({ key: '', ...page, cursor: page.nextCursor });
          remember();
        },
        // A refresh that fails keeps the rows already shown.
        error: () => {
          if (transactions().length === 0) status.set('failed');
        },
      });
    };

    effect(() => {
      current = request();
      const next = current;
      if (next !== undefined) untracked(() => loadFirst(next));
    });
    const version = this.invalidation.version('transactionList');
    let seen = untracked(version);
    effect(() => {
      const latest = version();
      if (latest === seen) return;
      seen = latest;
      const next = untracked(() => current);
      if (next !== undefined) untracked(() => loadFirst({ ...next, restore: false }));
    });
    inject(DestroyRef).onDestroy(() => {
      firstRequest?.unsubscribe();
      moreRequest?.unsubscribe();
    });

    return {
      transactions: transactions.asReadonly(),
      count: count.asReadonly(),
      sum: sum.asReadonly(),
      hasMore: computed(() => cursor() !== null),
      status: status.asReadonly(),
      loadingMore: loadingMore.asReadonly(),
      moreFailed: moreFailed.asReadonly(),
      loadMore: () => {
        const before = cursor();
        if (before === null || loadingMore() || current === undefined) return;
        loadingMore.set(true);
        moreFailed.set(false);
        moreRequest = this.fetch(current.filters, before).subscribe({
          next: (page) => {
            transactions.update((shown) => [...shown, ...page.transactions]);
            cursor.set(page.nextCursor);
            count.set(page.count);
            sum.set(page.sum);
            remember();
            loadingMore.set(false);
          },
          error: () => {
            moreFailed.set(true);
            loadingMore.set(false);
          },
        });
      },
    };
  }

  private fetch(filters: TransactionFilters, before?: string): Observable<TransactionsResponse> {
    return this.http.get<TransactionsResponse>('/api/transactions', {
      params: { ...filtersToParams(filters), ...(before === undefined ? {} : { before }) },
    });
  }

  details(id: Signal<string | undefined>): ParamRead<TransactionDetails> {
    return paramRead<string, TransactionDetails>(
      id,
      (value) => ({ url: this.detailsUrl(value) }),
      this.invalidation.version('transactionDetails'),
    );
  }

  get(id: string): Observable<TransactionDetails> {
    return this.http.get<TransactionDetails>(this.detailsUrl(id));
  }

  private detailsUrl(id: string): string {
    return `/api/transactions/${encodeURIComponent(id)}`;
  }

  offsetCandidates(id: number, search = ''): Observable<OffsetCandidatesResponse> {
    return this.http.get<OffsetCandidatesResponse>(`/api/transactions/${id}/offset-candidates`, {
      params: search.trim() === '' ? {} : { q: search.trim() },
    });
  }

  addManual(request: ManualTransactionRequest): Observable<Transaction> {
    return this.http
      .post<Transaction>('/api/transactions', request)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  editManual(id: number, request: ManualTransactionRequest): Observable<Transaction> {
    return this.http
      .put<Transaction>(`/api/transactions/${id}`, request)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  deleteManual(id: number): Observable<void> {
    return this.http
      .delete<void>(`/api/transactions/${id}`)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  replace(request: ReplacementRequest): Observable<void> {
    return this.http
      .post<void>('/api/transactions/replace', request)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  notSame(request: ReplacementRequest): Observable<void> {
    return this.http
      .post<void>('/api/transactions/not-same', request)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  /**
   * The list kept for the way back is updated in place, so it keeps its pages and does not show
   * the old category: the row itself, the similar rows that were re-guessed and the refunds that
   * follow it. A row that no longer matches an active category filter stays until the list is
   * next loaded afresh.
   */
  setCategory(id: number, subcategoryId: number | null): Observable<TransactionCategoryResponse> {
    const body: SetTransactionCategoryRequest = { subcategoryId };
    return this.http
      .put<TransactionCategoryResponse>(`/api/transactions/${id}/category`, body)
      .pipe(
        tap(({ category, others }) => {
          const listed = this.listed;
          // Firing drops the kept list, so the updated one is put back afterwards.
          this.invalidation.fire('transactions');
          if (listed === null) return;
          const categories = new Map(others.map((o) => [o.id, o.category]));
          categories.set(id, category);
          // Only the rows' categories change here. With a category filter active, `count` and
          // `sum` and the rows' membership stay as loaded until the next fresh load.
          this.listed = {
            ...listed,
            transactions: listed.transactions.map((t) =>
              categories.has(t.id) ? { ...t, category: categories.get(t.id)! } : t,
            ),
          };
        }),
      );
  }

  setOffset(id: number, purchaseId: number | null): Observable<TransactionDetails> {
    const body: SetTransactionOffsetRequest = { purchaseId };
    return this.http
      .put<TransactionDetails>(`/api/transactions/${id}/offset`, body)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }

  setShare(id: number, share: ShareOption | null): Observable<TransactionDetails> {
    const body: SetTransactionShareRequest = { share };
    return this.http
      .put<TransactionDetails>(`/api/transactions/${id}/share`, body)
      .pipe(tap(() => this.invalidation.fire('transactions')));
  }
}
