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
