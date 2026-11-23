import { Injectable, signal } from '@angular/core';

/**
 * What the navigation shows about the bank connections. Banker already fetches the accounts, so
 * it reports here; nothing polls for the navigation's sake, and it stays empty until Banker has
 * been opened.
 */
@Injectable({ providedIn: 'root' })
export class SyncStatusService {
  /** When any account was last synced (ISO 8601), or null if unknown. */
  readonly lastSyncedAt = signal<string | null>(null);
  /** True when the last finished sync was rate limited or left accounts out. */
  readonly lastFailed = signal(false);
  /** How many connections are expiring or expired. */
  readonly expiringCount = signal(0);

  report(status: { lastSyncedAt: string | null; failed: boolean; expiring: number }): void {
    this.lastSyncedAt.set(status.lastSyncedAt);
    this.lastFailed.set(status.failed);
    this.expiringCount.set(status.expiring);
  }

  reset(): void {
    this.report({ lastSyncedAt: null, failed: false, expiring: 0 });
  }
}
