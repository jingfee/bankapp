import { signal } from '@angular/core';
import type { AccountsResponse, StartSyncResponse } from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { BanksStore } from './banks.store';
import { Recorder } from './recorder';

export class FakeBanksStore extends BanksStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;

  readonly lastSyncedAt = signal<string | null>(null);
  readonly lastFailed = signal(false);
  readonly expiringCount = signal(0);

  report(status: { lastSyncedAt: string | null; failed: boolean; expiring: number }): void {
    this.lastSyncedAt.set(status.lastSyncedAt);
    this.lastFailed.set(status.failed);
    this.expiringCount.set(status.expiring);
  }
  reportAccounts(result: AccountsResponse): void {
    this.calls.push({ method: 'reportAccounts', args: [result] });
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
