import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  HouseholdRatioEntry,
  HouseholdRatioResponse,
  ShareOption,
  SubcategoryShare,
  SubcategorySharesResponse,
} from '@bankapp/shared';
import { type Observable, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SharesService {
  private readonly http = inject(HttpClient);

  /** The household ratio, earliest entry first. */
  householdRatio(): Observable<HouseholdRatioEntry[]> {
    return this.http
      .get<HouseholdRatioResponse>('/api/household-ratio')
      .pipe(map((response) => response.entries));
  }

  /** Replaces the whole household ratio list. */
  setHouseholdRatio(entries: HouseholdRatioEntry[]): Observable<HouseholdRatioEntry[]> {
    return this.http
      .put<HouseholdRatioResponse>('/api/household-ratio', { entries })
      .pipe(map((response) => response.entries));
  }

  /** The subcategories whose share is not Jag. */
  subcategoryShares(): Observable<SubcategoryShare[]> {
    return this.http
      .get<SubcategorySharesResponse>('/api/subcategory-shares')
      .pipe(map((response) => response.shares));
  }

  /** Sets a subcategory's share option. */
  setSubcategoryShare(id: number, share: ShareOption): Observable<void> {
    return this.http.put<void>(`/api/subcategories/${id}/share`, { share });
  }
}
