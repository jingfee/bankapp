import { HttpClient } from '@angular/common/http';
import { Injectable, forwardRef, inject } from '@angular/core';
import type { HouseholdRatioEntry, HouseholdRatioResponse, ShareOption } from '@bankapp/shared';
import { type Observable, map, tap } from 'rxjs';
import { Invalidation } from './invalidation';

@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpSharesStore) })
export abstract class SharesStore {
  /** Replaces the whole household ratio list. */
  abstract setHouseholdRatio(entries: HouseholdRatioEntry[]): Observable<HouseholdRatioEntry[]>;
  /** Sets a subcategory's share option. */
  abstract setSubcategoryShare(id: number, share: ShareOption): Observable<void>;
}

@Injectable()
export class HttpSharesStore extends SharesStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);

  setHouseholdRatio(entries: HouseholdRatioEntry[]): Observable<HouseholdRatioEntry[]> {
    return this.http.put<HouseholdRatioResponse>('/api/household-ratio', { entries }).pipe(
      tap(() => this.invalidation.fire('shares')),
      map((response) => response.entries),
    );
  }

  setSubcategoryShare(id: number, share: ShareOption): Observable<void> {
    return this.http
      .put<void>(`/api/subcategories/${id}/share`, { share })
      .pipe(tap(() => this.invalidation.fire('shares')));
  }
}
