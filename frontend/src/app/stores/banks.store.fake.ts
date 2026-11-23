import { signal } from '@angular/core';
import type { Bank, StartSyncResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { BanksStore } from './banks.store';
import { Recorder } from './recorder';

export class FakeBanksStore extends BanksStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  readonly lastSyncedAt = signal<string | null>(null);
  readonly lastFailed = signal(false);
  readonly expiringCount = signal(0);

  readonly available = signal<Bank[] | undefined>(undefined);
  readonly availableLoading = signal(false);
  readonly availableFailed = signal(false);

  activateAvailable(): void {
    this.calls.push({ method: 'activateAvailable', args: [] });
  }
  deactivateAvailable(): void {
    this.calls.push({ method: 'deactivateAvailable', args: [] });
  }
  report(status: { lastSyncedAt: string | null; failed: boolean; expiring: number }): void {
    this.lastSyncedAt.set(status.lastSyncedAt);
    this.lastFailed.set(status.failed);
    this.expiringCount.set(status.expiring);
  }
  loadOnce(): void {
    this.calls.push({ method: 'loadOnce', args: [] });
  }
  reset(): void {
    this.report({ lastSyncedAt: null, failed: false, expiring: 0 });
  }
  startConnection(bank: string, renew?: boolean): Observable<string> {
    return this.recorder.reply('startConnection', bank, renew);
  }
  connectionResult(): void {
    this.calls.push({ method: 'connectionResult', args: [] });
  }
  startSync(): Observable<StartSyncResponse> {
    return this.recorder.reply('startSync');
  }
  remove(bank: string, continueManually?: number[]): Observable<void> {
    return this.recorder.reply('remove', bank, continueManually);
  }
  deleteForGood(bank: string): Observable<void> {
    return this.recorder.reply('deleteForGood', bank);
  }
}
