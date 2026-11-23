import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, type Signal, forwardRef, inject, signal } from '@angular/core';
import type {
  AccountsResponse,
  StartConnectionRequest,
  StartConnectionResponse,
  StartSyncResponse,
} from '@bankapp/shared';
import { type Observable, map, tap } from 'rxjs';
import { AccountsService } from '../accounts.service';
import { Invalidation } from './invalidation';

/** How often the accounts are asked for again while a sync is running. */
export const SYNC_POLL_INTERVAL_MS = 2000;

/**
 * The bank connections: their mutations, and what the navigation shows about them (the sync
 * status). The status is reported from the accounts as they are fetched; while a sync is running
 * the store fetches them itself, unless a page keeps reporting, and fires `banks` when it ends.
 */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpBanksStore) })
export abstract class BanksStore {
  /** When any account was last synced (ISO 8601), or null if unknown. */
  abstract readonly lastSyncedAt: Signal<string | null>;
  /** True when the last finished sync was rate limited or left accounts out. */
  abstract readonly lastFailed: Signal<boolean>;
  /** How many connections are expiring or expired. */
  abstract readonly expiringCount: Signal<number>;

  abstract report(status: { lastSyncedAt: string | null; failed: boolean; expiring: number }): void;
  /** Reports the status held by an accounts response, and follows its sync if one is running. */
  abstract reportAccounts(result: AccountsResponse): void;
  /** Fetches the status once after login, unless something has reported it already. */
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
}

@Injectable()
export class HttpBanksStore extends BanksStore {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(AccountsService);
  private readonly invalidation = inject(Invalidation);

  private readonly lastSynced = signal<string | null>(null);
  private readonly failed = signal(false);
  private readonly expiring = signal(0);
  readonly lastSyncedAt = this.lastSynced.asReadonly();
  readonly lastFailed = this.failed.asReadonly();
  readonly expiringCount = this.expiring.asReadonly();

  private loading = false;
  /** Changes on logout, so answers to requests from the earlier session are ignored. */
  private session = 0;
  private loaded = false;
  private syncRunning = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.pollTimer));
  }

  report(status: { lastSyncedAt: string | null; failed: boolean; expiring: number }): void {
    this.loaded = true;
    this.lastSynced.set(status.lastSyncedAt);
    this.failed.set(status.failed);
    this.expiring.set(status.expiring);
  }

  reportAccounts(result: AccountsResponse): void {
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

  loadOnce(): void {
    if (this.loaded || this.loading) return;
    this.loading = true;
    const session = this.session;
    this.accounts.list().subscribe({
      next: (result) => {
        if (session !== this.session) return;
        this.loading = false;
        if (!this.loaded) this.reportAccounts(result);
      },
      // The status is a convenience; a failure leaves it empty until Banker reports.
      error: () => {
        if (session === this.session) this.loading = false;
      },
    });
  }

  reset(): void {
    this.report({ lastSyncedAt: null, failed: false, expiring: 0 });
    this.loaded = false;
    clearTimeout(this.pollTimer);
    this.syncRunning = false;
    this.loading = false;
    this.session++;
  }

  /** Polls while a sync runs, and fires `banks` once one that was running has finished. */
  private followSync(running: boolean): void {
    clearTimeout(this.pollTimer);
    if (running) {
      this.syncRunning = true;
      this.pollWhileRunning();
    } else if (this.syncRunning) {
      this.syncRunning = false;
      this.invalidation.fire('banks');
    }
  }

  private pollWhileRunning(): void {
    // A page that follows the sync reports every interval, which postpones this poll; it only
    // fires when nobody else is watching, e.g. for a scheduled sync noticed from another page.
    const session = this.session;
    this.pollTimer = setTimeout(() => {
      this.accounts.list().subscribe({
        next: (result) => session === this.session && this.reportAccounts(result),
        error: () => session === this.session && this.pollWhileRunning(),
      });
    }, SYNC_POLL_INTERVAL_MS * 1.5);
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
    return this.http.post<StartSyncResponse>('/api/sync', null);
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
