import type {
  BalanceEntryRequest,
  CloseManualSavingsAccountRequest,
  ManualSavingsAccount,
  ManualSavingsAccountRequest,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { Recorder } from './recorder';
import { SavingsStore } from './savings.store';

export class FakeSavingsStore extends SavingsStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;

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
