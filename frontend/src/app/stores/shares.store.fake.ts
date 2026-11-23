import type { HouseholdRatioEntry, ShareOption } from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { Recorder } from './recorder';
import { SharesStore } from './shares.store';

export class FakeSharesStore extends SharesStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;

  setHouseholdRatio(entries: HouseholdRatioEntry[]): Observable<HouseholdRatioEntry[]> {
    return this.recorder.reply('setHouseholdRatio', entries);
  }
  setSubcategoryShare(id: number, share: ShareOption): Observable<void> {
    return this.recorder.reply('setSubcategoryShare', id, share);
  }
}
