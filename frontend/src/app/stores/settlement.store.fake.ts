import { signal } from '@angular/core';
import type {
  CloseMonthRequest,
  SetBalanceSettingRequest,
  SetOpenMonthRequest,
  SettlementResponse,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { Recorder } from './recorder';
import { SettlementStore } from './settlement.store';

export class FakeSettlementStore extends SettlementStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  readonly settlement = signal<SettlementResponse | undefined>(undefined);
  readonly fetchedAt = signal<Date | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);

  activate(): void {
    this.calls.push({ method: 'activate', args: [] });
  }
  deactivate(): void {
    this.calls.push({ method: 'deactivate', args: [] });
  }
  setBalance(request: SetBalanceSettingRequest): Observable<SettlementResponse> {
    return this.recorder.reply('setBalance', request);
  }
  close(request: CloseMonthRequest): Observable<SettlementResponse> {
    return this.recorder.reply('close', request);
  }
  undoClose(): Observable<SettlementResponse> {
    return this.recorder.reply('undoClose');
  }
  saveReport(month: string): Observable<SettlementResponse> {
    return this.recorder.reply('saveReport', month);
  }
  setOpenMonth(request: SetOpenMonthRequest): Observable<SettlementResponse> {
    return this.recorder.reply('setOpenMonth', request);
  }
}
