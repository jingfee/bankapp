import type {
  ManualTransactionRequest,
  ReplacementRequest,
  ShareOption,
  Transaction,
  TransactionCategoryResponse,
  TransactionDetails,
} from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { Recorder } from './recorder';
import { TransactionsStore } from './transactions.store';

export class FakeTransactionsStore extends TransactionsStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  addManual(request: ManualTransactionRequest): Observable<Transaction> {
    return this.recorder.reply('addManual', request);
  }
  editManual(id: number, request: ManualTransactionRequest): Observable<Transaction> {
    return this.recorder.reply('editManual', id, request);
  }
  deleteManual(id: number): Observable<void> {
    return this.recorder.reply('deleteManual', id);
  }
  replace(request: ReplacementRequest): Observable<void> {
    return this.recorder.reply('replace', request);
  }
  notSame(request: ReplacementRequest): Observable<void> {
    return this.recorder.reply('notSame', request);
  }
  setCategory(id: number, subcategoryId: number | null): Observable<TransactionCategoryResponse> {
    return this.recorder.reply('setCategory', id, subcategoryId);
  }
  setOffset(id: number, purchaseId: number | null): Observable<TransactionDetails> {
    return this.recorder.reply('setOffset', id, purchaseId);
  }
  setShare(id: number, share: ShareOption | null): Observable<TransactionDetails> {
    return this.recorder.reply('setShare', id, share);
  }
}
