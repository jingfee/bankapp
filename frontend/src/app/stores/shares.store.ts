import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, type Signal, computed, forwardRef, inject, signal } from '@angular/core';
import type {
  HouseholdRatioEntry,
  HouseholdRatioResponse,
  ShareOption,
  SubcategoryShare,
  SubcategorySharesResponse,
} from '@bankapp/shared';
import { type Observable, map, tap } from 'rxjs';
import { Invalidation } from './invalidation';
import { keptFetchedAt, keptValue } from './kept';

@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpSharesStore) })
export abstract class SharesStore {
  /** The household ratio, earliest entry first; undefined until it has been fetched. */
  abstract readonly householdRatio: Signal<HouseholdRatioEntry[] | undefined>;
  /** The `from` of the ratio entry in force today, as the backend works it out; null with no entries. */
  abstract readonly householdRatioInForceFrom: Signal<string | null | undefined>;
  /** The subcategories whose share is not Jag; undefined until they have been fetched. */
  abstract readonly subcategoryShares: Signal<SubcategoryShare[] | undefined>;
  /** When the device fetched what is shown: the older of the ratio and the shares. */
  abstract readonly fetchedAt: Signal<Date | undefined>;
  /** True while either is being fetched for the first time. */
  abstract readonly loading: Signal<boolean>;
  /** True when either could not be fetched and there is nothing older to show for it. */
  abstract readonly failed: Signal<boolean>;
  /** Starts fetching the ratio and the shares, for as long as a page shows them; every call needs its own `deactivate`. */
  abstract activate(): void;
  /** Stops fetching and forgets them. */
  abstract deactivate(): void;

  /** Replaces the whole household ratio list. */
  abstract setHouseholdRatio(entries: HouseholdRatioEntry[]): Observable<HouseholdRatioEntry[]>;
  /** Sets a subcategory's share option. */
  abstract setSubcategoryShare(id: number, share: ShareOption): Observable<void>;
}

@Injectable()
export class HttpSharesStore extends SharesStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);

  /** Pages showing the shares; a page opened before the previous one closes must not lose them. */
  private readonly users = signal(0);
  private readonly active = computed(() => this.users() > 0);
  private readonly ratioResource = httpResource<HouseholdRatioResponse>(() =>
    this.active() ? '/api/household-ratio' : undefined,
  );
  private readonly sharesResource = httpResource<SubcategorySharesResponse>(() =>
    this.active() ? '/api/subcategory-shares' : undefined,
  );
  private readonly ratioResponse = keptValue(this.ratioResource, this.active);
  private readonly sharesResponse = keptValue(this.sharesResource, this.active);

  private readonly ratioFetchedAt = keptFetchedAt(this.ratioResource, this.active);
  private readonly sharesFetchedAt = keptFetchedAt(this.sharesResource, this.active);
  readonly fetchedAt = computed(() => {
    const times = [this.ratioFetchedAt(), this.sharesFetchedAt()].flatMap((at) => (at ? [at] : []));
    return times.length === 0 ? undefined : new Date(Math.min(...times.map((at) => at.getTime())));
  });
  readonly householdRatio = computed(() => this.ratioResponse()?.entries);
  readonly householdRatioInForceFrom = computed(() => this.ratioResponse()?.inForceFrom);
  readonly subcategoryShares = computed(() => this.sharesResponse()?.shares);
  readonly loading = computed(
    () =>
      (this.ratioResource.isLoading() && this.ratioResponse() === undefined) ||
      (this.sharesResource.isLoading() && this.sharesResponse() === undefined),
  );
  readonly failed = computed(
    () =>
      (this.ratioResource.status() === 'error' && this.ratioResponse() === undefined) ||
      (this.sharesResource.status() === 'error' && this.sharesResponse() === undefined),
  );

  constructor() {
    super();
    this.invalidation.onRead('shares', () => {
      this.ratioResource.reload();
      this.sharesResource.reload();
    });
  }

  activate(): void {
    this.users.update((n) => n + 1);
  }

  deactivate(): void {
    this.users.update((n) => Math.max(0, n - 1));
  }

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
