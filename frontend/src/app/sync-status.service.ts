import { Injectable, inject, signal } from '@angular/core';
import type { AccountsResponse } from '@bankapp/shared';
import { AccountsService } from './accounts.service';

/**
 * What the navigation shows about the bank connections. The app loads it once after login
 * (one request, no polling) and Banker reports here whenever it fetches the accounts.
 */
@Injectable({ providedIn: 'root' })
export class SyncStatusService {
  private readonly accounts = inject(AccountsService);
  private loading = false;
  private loaded = false;

  /** When any account was last synced (ISO 8601), or null if unknown. */
  readonly lastSyncedAt = signal<string | null>(null);
  /** True when the last finished sync was rate limited or left accounts out. */
  readonly lastFailed = signal(false);
  /** How many connections are expiring or expired. */
  readonly expiringCount = signal(0);

  report(status: { lastSyncedAt: string | null; failed: boolean; expiring: number }): void {
    this.loaded = true;
    this.lastSyncedAt.set(status.lastSyncedAt);
    this.lastFailed.set(status.failed);
    this.expiringCount.set(status.expiring);
  }

  /** Reports the status held by an accounts response. */
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
  }

  /** Fetches the status once after login, unless something has reported it already. */
  loadOnce(): void {
    if (this.loaded || this.loading) return;
    this.loading = true;
    this.accounts.list().subscribe({
      next: (result) => {
        this.loading = false;
        if (!this.loaded) this.reportAccounts(result);
      },
      // The status is a convenience; a failure leaves it empty until Banker reports.
      error: () => (this.loading = false),
    });
  }

  reset(): void {
    this.report({ lastSyncedAt: null, failed: false, expiring: 0 });
    this.loaded = false;
  }
}
