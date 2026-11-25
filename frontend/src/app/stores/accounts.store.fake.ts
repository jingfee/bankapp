import { signal } from '@angular/core';
import type { AccountsResponse, ShareOption } from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { AccountsStore } from './accounts.store';
import { Recorder } from './recorder';

export class FakeAccountsStore extends AccountsStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  readonly accounts = signal<AccountsResponse | undefined>(undefined);
  readonly fetchedAt = signal<Date | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);

  activate(): void {
    this.calls.push({ method: 'activate', args: [] });
  }
  deactivate(): void {
    this.calls.push({ method: 'deactivate', args: [] });
  }
  reload(): void {
    this.calls.push({ method: 'reload', args: [] });
  }
  setSavings(id: number, savings: boolean): Observable<void> {
    return this.recorder.reply('setSavings', id, savings);
  }
  setHidden(id: number, hidden: boolean): Observable<void> {
    return this.recorder.reply('setHidden', id, hidden);
  }
  setShare(id: number, share: ShareOption): Observable<void> {
    return this.recorder.reply('setShare', id, share);
  }
}
