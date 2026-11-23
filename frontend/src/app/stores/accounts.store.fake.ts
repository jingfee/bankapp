import type { ShareOption } from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { AccountsStore } from './accounts.store';
import { Recorder } from './recorder';

export class FakeAccountsStore extends AccountsStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;

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
