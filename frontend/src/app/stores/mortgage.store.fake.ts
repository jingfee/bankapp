import { computed, signal } from '@angular/core';
import type {
  AddLoanPartRequest,
  AmortisationChangeRequest,
  EndLoanPartRequest,
  InterestRateChangeRequest,
  MortgageEntryRequest,
  MortgageFiguresResponse,
  MortgageResponse,
  UpdateLoanPartRequest,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';
import type { ParamRead } from './kept';
import { MortgageStore } from './mortgage.store';
import { Recorder } from './recorder';

export class FakeMortgageStore extends MortgageStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  /** What the reads answer; a test sets them: the response, 'error', or undefined while loading. */
  readonly mortgageAnswer = signal<MortgageResponse | 'error' | undefined>(undefined);
  readonly figuresAnswer = signal<MortgageFiguresResponse | 'error' | undefined>(undefined);

  private answer<T>(answer: typeof this.mortgageAnswer | typeof this.figuresAnswer): ParamRead<T> {
    const current = () => answer() as T | 'error' | undefined;
    return {
      value: computed(() => {
        const a = current();
        return a === 'error' ? undefined : a;
      }),
      loading: computed(() => current() === undefined),
      failed: computed(() => current() === 'error'),
      error: computed(() => (current() === 'error' ? new Error('failed') : undefined)),
    };
  }

  mortgage(): ParamRead<MortgageResponse> {
    return this.answer(this.mortgageAnswer);
  }
  figures(): ParamRead<MortgageFiguresResponse> {
    return this.answer(this.figuresAnswer);
  }

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
