import { computed, signal } from '@angular/core';
import type {
  BalanceEntryRequest,
  CloseManualSavingsAccountRequest,
  ManualSavingsAccount,
  ManualSavingsAccountRequest,
  ManualSavingsResponse,
  SavingsResponse,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';
import type { ParamRead } from './kept';
import { Recorder } from './recorder';
import { SavingsStore } from './savings.store';

export class FakeSavingsStore extends SavingsStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  /** What the reads answer; a test sets them: the response, 'error', or undefined while loading. */
  readonly savingsAnswer = signal<SavingsResponse | 'error' | undefined>(undefined);
  readonly manualSavingsAnswer = signal<ManualSavingsResponse | 'error' | undefined>(undefined);

  private answer<T>(
    answer: typeof this.savingsAnswer | typeof this.manualSavingsAnswer,
  ): ParamRead<T> {
    const current = () => answer() as T | 'error' | undefined;
    return {
      value: computed(() => {
        const a = current();
        return a === 'error' ? undefined : a;
      }),
      loading: computed(() => current() === undefined),
      failed: computed(() => current() === 'error'),
      fetchedAt: computed(() => undefined),
      error: computed(() => (current() === 'error' ? new Error('failed') : undefined)),
    };
  }

  savings(): ParamRead<SavingsResponse> {
    return this.answer(this.savingsAnswer);
  }
  manualSavings(): ParamRead<ManualSavingsResponse> {
    return this.answer(this.manualSavingsAnswer);
  }

  create(request: ManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.recorder.reply('create', request);
  }
  rename(id: number, request: ManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.recorder.reply('rename', id, request);
  }
  close(id: number, request: CloseManualSavingsAccountRequest): Observable<ManualSavingsAccount> {
    return this.recorder.reply('close', id, request);
  }
  reopen(id: number): Observable<ManualSavingsAccount> {
    return this.recorder.reply('reopen', id);
  }
  addEntry(id: number, request: BalanceEntryRequest): Observable<ManualSavingsAccount> {
    return this.recorder.reply('addEntry', id, request);
  }
  updateEntry(
    id: number,
    entryId: number,
    request: BalanceEntryRequest,
  ): Observable<ManualSavingsAccount> {
    return this.recorder.reply('updateEntry', id, entryId, request);
  }
  deleteEntry(id: number, entryId: number): Observable<ManualSavingsAccount> {
    return this.recorder.reply('deleteEntry', id, entryId);
  }
}
