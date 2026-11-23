import type {
  AddLoanPartRequest,
  AmortisationChangeRequest,
  EndLoanPartRequest,
  InterestRateChangeRequest,
  MortgageEntryRequest,
  MortgageResponse,
  UpdateLoanPartRequest,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { MortgageStore } from './mortgage.store';
import { Recorder } from './recorder';

export class FakeMortgageStore extends MortgageStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  addPart(request: AddLoanPartRequest): Observable<MortgageResponse> {
    return this.recorder.reply('addPart', request);
  }
  updatePart(id: number, request: UpdateLoanPartRequest): Observable<MortgageResponse> {
    return this.recorder.reply('updatePart', id, request);
  }
  endPart(id: number, request: EndLoanPartRequest): Observable<MortgageResponse> {
    return this.recorder.reply('endPart', id, request);
  }
  addRateChange(id: number, request: InterestRateChangeRequest): Observable<MortgageResponse> {
    return this.recorder.reply('addRateChange', id, request);
  }
  addAmortisationChange(
    id: number,
    request: AmortisationChangeRequest,
  ): Observable<MortgageResponse> {
    return this.recorder.reply('addAmortisationChange', id, request);
  }
  addEntry(request: MortgageEntryRequest): Observable<MortgageResponse> {
    return this.recorder.reply('addEntry', request);
  }
  updateEntry(id: number, request: MortgageEntryRequest): Observable<MortgageResponse> {
    return this.recorder.reply('updateEntry', id, request);
  }
  deleteEntry(id: number): Observable<MortgageResponse> {
    return this.recorder.reply('deleteEntry', id);
  }
}
