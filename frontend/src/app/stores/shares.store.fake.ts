import { signal } from '@angular/core';
import type { HouseholdRatioEntry, ShareOption, SubcategoryShare } from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { Recorder } from './recorder';
import { SharesStore } from './shares.store';

export class FakeSharesStore extends SharesStore {
  private readonly recorder = new Recorder();
  readonly calls = this.recorder.calls;
  readonly responses = this.recorder.responses;
  readonly failures = this.recorder.failures;

  readonly householdRatio = signal<HouseholdRatioEntry[] | undefined>(undefined);
  readonly subcategoryShares = signal<SubcategoryShare[] | undefined>(undefined);
  readonly loading = signal(false);
  readonly failed = signal(false);

  activate(): void {
    this.calls.push({ method: 'activate', args: [] });
  }
  deactivate(): void {
    this.calls.push({ method: 'deactivate', args: [] });
  }
  setHouseholdRatio(entries: HouseholdRatioEntry[]): Observable<HouseholdRatioEntry[]> {
    return this.recorder.reply('setHouseholdRatio', entries);
  }
  setSubcategoryShare(id: number, share: ShareOption): Observable<void> {
    return this.recorder.reply('setSubcategoryShare', id, share);
  }
}
