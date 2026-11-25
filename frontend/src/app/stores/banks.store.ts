import { HttpClient, httpResource } from '@angular/common/http';
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
  AccountsResponse,
  Bank,
  BanksResponse,
  StartConnectionRequest,
  StartConnectionResponse,
  StartSyncResponse,
} from '@bankapp/shared';
import { type Observable, map, tap } from 'rxjs';
import { AccountsStore } from './accounts.store';
import { Invalidation } from './invalidation';
import { keptFetchedAt, keptValue } from './kept';
import { DAY_MS } from '../dates';

/** How often the accounts are asked for again while a sync is running. */
export const SYNC_POLL_INTERVAL_MS = 2000;

/** How long a bank connection is good for when it is made or renewed. */
const CONNECTION_DAYS = 90;

/**
 * The bank connections: their mutations, and what Banker and the navigation show about them
 * (the sync status, how long a connection has left). The status follows the accounts as
 * `AccountsStore` fetches them; while a sync is running the store has them fetched again, and
 * fires `banks` when it ends.
 */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpBanksStore) })
export abstract class BanksStore {
  /** When any account was last synced (ISO 8601), or null if unknown. */
  abstract readonly lastSyncedAt: Signal<string | null>;
  /** True when the last finished sync was rate limited or left accounts out. */
  abstract readonly lastFailed: Signal<boolean>;
  /** How many connections are expiring or expired. */
  abstract readonly expiringCount: Signal<number>;

  /** The banks that can be connected; undefined until they have been fetched. */
  abstract readonly available: Signal<Bank[] | undefined>;
  /** When the device fetched `available`; undefined until the first fetch succeeds. */
  abstract readonly availableFetchedAt: Signal<Date | undefined>;
  /** True while the list of banks is being fetched for the first time. */
  abstract readonly availableLoading: Signal<boolean>;
  /** True when the list of banks could not be fetched and there is nothing older to show. */
  abstract readonly availableFailed: Signal<boolean>;
  /** Starts fetching the list of banks, for as long as a page shows it; every call needs its own `deactivateAvailable`. */
  abstract activateAvailable(): void;
  /** Stops fetching the list of banks and forgets it. */
  abstract deactivateAvailable(): void;

  abstract report(status: { lastSyncedAt: string | null; failed: boolean; expiring: number }): void;
  /** Starts following the accounts once the owner is logged in. */
  abstract loadOnce(): void;
  /** Forgets the status, when the owner logs out. */
  abstract reset(): void;

  /**
   * Starts a BankID login for the bank; emits the URL to send the owner to. `renew` asks to
   * renew a connection that is still active.
   */
  abstract startConnection(bank: string, renew?: boolean): Observable<string>;
  /** The owner is back from BankID: whatever came of it, the connections may have changed. */
  abstract connectionResult(): void;
  /** Starts a manual sync; progress is read from the accounts. */
  abstract startSync(): Observable<StartSyncResponse>;
  /**
   * Removes a bank the owner no longer uses; its history stays. The savings accounts in
   * `continueManually` carry on as manual savings accounts; the others close.
   */
  abstract remove(bank: string, continueManually?: number[]): Observable<void>;
  /** Erases a removed bank and everything it brought in (ADR 0013). */
  abstract deleteForGood(bank: string): Observable<void>;

  /** Whole days left of a connection that is good until `validUntil`, at least 1. */
  daysLeft(validUntil: string): number {
    return Math.max(1, Math.ceil((Date.parse(validUntil) - Date.now()) / DAY_MS));
  }

  /** How much of a full connection period is left, from 0 to 1. */
  connectionLeft(validUntil: string): number {
    const left = (Date.parse(validUntil) - Date.now()) / DAY_MS;
    return Math.min(1, Math.max(0, left / CONNECTION_DAYS));
  }
}

@Injectable()
export class HttpBanksStore extends BanksStore {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(AccountsStore);
  private readonly invalidation = inject(Invalidation);

  private readonly lastSynced = signal<string | null>(null);
  private readonly failed = signal(false);
  private readonly expiring = signal(0);
  readonly lastSyncedAt = this.lastSynced.asReadonly();
  readonly lastFailed = this.failed.asReadonly();
  readonly expiringCount = this.expiring.asReadonly();

  private readonly availableUsers = signal(0);
  private readonly availableActive = computed(() => this.availableUsers() > 0);
  private readonly availableResource = httpResource<BanksResponse>(() =>
    this.availableActive() ? '/api/banks' : undefined,
  );
  private readonly availableResponse = keptValue(this.availableResource, this.availableActive);
  readonly availableFetchedAt = keptFetchedAt(this.availableResource, this.availableActive);
  readonly available = computed(() => this.availableResponse()?.banks);
  readonly availableLoading = computed(
    () => this.availableResource.isLoading() && this.availableResponse() === undefined,
  );
  readonly availableFailed = computed(
    () => this.availableResource.status() === 'error' && this.availableResponse() === undefined,
  );

  private syncRunning = false;
  /** Polls left to wait for a sync the owner started to show up as running. */
  private awaitingStart = 0;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pollTimer));
    this.invalidation.onRead('banks', () => this.availableResource.reload());
    effect(() => {
      const result = this.accounts.accounts();
      if (result) untracked(() => this.reportAccounts(result));
    });
  }

  activateAvailable(): void {
    this.availableUsers.update((n) => n + 1);
  }

  deactivateAvailable(): void {
    this.availableUsers.update((n) => Math.max(0, n - 1));
  }

  report(status: { lastSyncedAt: string | null; failed: boolean; expiring: number }): void {
    this.lastSynced.set(status.lastSyncedAt);
    this.failed.set(status.failed);
    this.expiring.set(status.expiring);
  }

  loadOnce(): void {
    this.accounts.activate();
  }

  reset(): void {
    this.accounts.deactivate();
    this.report({ lastSyncedAt: null, failed: false, expiring: 0 });
    clearTimeout(this.pollTimer);
    this.syncRunning = false;
    this.awaitingStart = 0;
  }

  private reportAccounts(result: AccountsResponse): void {
    const times = result.banks.flatMap((group) =>
      group.accounts.flatMap((account) => (account.lastSyncedAt ? [account.lastSyncedAt] : [])),
    );
    this.report({
      lastSyncedAt: times.length === 0 ? null : times.reduce((a, b) => (a > b ? a : b)),
      failed:
        !!result.lastSync && (result.lastSync.failedAccounts > 0 || result.lastSync.rateLimited),
      expiring: result.banks.filter((group) => group.status !== 'active').length,
    });
    this.followSync(result.syncing !== null);
  }

  /** Polls while a sync runs, and fires `banks` once one that was running has finished. */
  private followSync(running: boolean): void {
    clearTimeout(this.pollTimer);
    if (running) {
      this.syncRunning = true;
      this.awaitingStart = 0;
      this.pollWhileRunning();
    } else if (!this.syncRunning && this.awaitingStart > 0) {
      // A sync was just started and the server has not shown it yet: it is not finished.
      this.pollWhileRunning();
    } else if (this.syncRunning) {
      this.syncRunning = false;
      this.invalidation.fire('banks');
    }
  }

  private pollWhileRunning(): void {
    // Asked again every interval, also after a failed fetch, so a sync is never left unfollowed.
    this.pollTimer = setTimeout(() => {
      if (!this.syncRunning && --this.awaitingStart < 0) return;
      this.accounts.reload();
      this.pollWhileRunning();
    }, SYNC_POLL_INTERVAL_MS);
  }

  startConnection(bank: string, renew = false): Observable<string> {
    const body: StartConnectionRequest = renew ? { bank, renew } : { bank };
    return this.http
      .post<StartConnectionResponse>('/api/connections', body)
      .pipe(map((response) => response.url));
  }

  connectionResult(): void {
    this.invalidation.fire('banks');
  }

  startSync(): Observable<StartSyncResponse> {
    return this.http.post<StartSyncResponse>('/api/sync', null).pipe(
      tap(() => {
        // Followed from now on, even if the first answer does not show it running yet.
        this.awaitingStart = 5;
        this.accounts.reload();
        this.pollWhileRunning();
      }),
    );
  }

  remove(bank: string, continueManually: number[] = []): Observable<void> {
    const params: Record<string, string> =
      continueManually.length > 0 ? { continueManually: continueManually.join(',') } : {};
    return this.http
      .delete<void>(`/api/connections/${encodeURIComponent(bank)}`, { params })
      .pipe(tap(() => this.invalidation.fire('banks')));
  }

  deleteForGood(bank: string): Observable<void> {
    return this.http
      .delete<void>(`/api/connections/${encodeURIComponent(bank)}/permanent`)
      .pipe(tap(() => this.invalidation.fire('banks')));
  }
}
