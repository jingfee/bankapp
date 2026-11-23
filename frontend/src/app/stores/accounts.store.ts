import { HttpClient, httpResource } from '@angular/common/http';
import {
  Injectable,
  type Signal,
  computed,
  forwardRef,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import type { AccountsResponse, ShareOption } from '@bankapp/shared';
import { type Observable, tap } from 'rxjs';
import { Invalidation } from './invalidation';

@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpAccountsStore) })
export abstract class AccountsStore {
  /**
   * The accounts of every connected bank, grouped by bank, and whether a sync is running. A
   * refresh that fails keeps what was fetched before; undefined until the first fetch succeeds.
   */
  abstract readonly accounts: Signal<AccountsResponse | undefined>;
  /** True while the first fetch is under way. */
  abstract readonly loading: Signal<boolean>;
  /** True when the accounts could not be fetched and there is nothing older to show. */
  abstract readonly failed: Signal<boolean>;
  /** Starts fetching the accounts; they are only fetched while the owner is logged in. */
  abstract activate(): void;
  /** Stops fetching and forgets the accounts, when the owner logs out. */
  abstract deactivate(): void;
  /** Fetches the accounts again, e.g. to follow a sync. */
  abstract reload(): void;

  /** Marks an account as a savings account (followed by balance only), or clears it. */
  abstract setSavings(id: number, savings: boolean): Observable<void>;
  /** Hides an account from the overview and its transactions, or shows it again. */
  abstract setHidden(id: number, hidden: boolean): Observable<void>;
  /** Sets the share the owner bears of an account's transactions. */
  abstract setShare(id: number, share: ShareOption): Observable<void>;
}

@Injectable()
export class HttpAccountsStore extends AccountsStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);

  private readonly active = signal(false);
  private readonly resource = httpResource<AccountsResponse>(() =>
    this.active() ? '/api/accounts' : undefined,
  );

  readonly accounts = linkedSignal<
    { value: AccountsResponse | undefined; active: boolean },
    AccountsResponse | undefined
  >({
    source: () => ({
      value: this.resource.hasValue() ? this.resource.value() : undefined,
      active: this.active(),
    }),
    computation: (next, previous) => {
      return next.value ?? (next.active ? previous?.value : undefined);
    },
  });
  readonly loading = computed(() => this.resource.isLoading() && this.accounts() === undefined);
  readonly failed = computed(
    () => this.resource.status() === 'error' && this.accounts() === undefined,
  );

  constructor() {
    super();
    this.invalidation.onRead('accounts', () => this.resource.reload());
  }

  activate(): void {
    this.active.set(true);
  }

  deactivate(): void {
    this.active.set(false);
  }

  reload(): void {
    this.resource.reload();
  }

  setSavings(id: number, savings: boolean): Observable<void> {
    return this.http
      .put<void>(`/api/accounts/${id}/savings`, { savings })
      .pipe(tap(() => this.invalidation.fire('accounts')));
  }

  setHidden(id: number, hidden: boolean): Observable<void> {
    return this.http
      .put<void>(`/api/accounts/${id}/hidden`, { hidden })
      .pipe(tap(() => this.invalidation.fire('accounts')));
  }

  setShare(id: number, share: ShareOption): Observable<void> {
    return this.http
      .put<void>(`/api/accounts/${id}/share`, { share })
      .pipe(tap(() => this.invalidation.fire('accounts')));
  }
}
