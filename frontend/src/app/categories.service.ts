import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CategoriesResponse, Category, Subcategory } from '@bankapp/shared';
import { type Observable, map, shareReplay } from 'rxjs';

/** A subcategory together with the category it belongs to. */
export interface CategorisedSubcategory {
  category: Category;
  subcategory: Subcategory;
}

@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly http = inject(HttpClient);
  private cached: Observable<Category[]> | undefined;

  /** Every category with its subcategories, in the owner's order. Requested once per session. */
  list(): Observable<Category[]> {
    this.cached ??= this.http.get<CategoriesResponse>('/api/categories').pipe(
      map((response) => response.categories),
      // A failed request is not kept, so the next caller asks again.
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.cached;
  }

  /** Forgets the categories, so the next owner to log in gets their own. */
  reset(): void {
    this.cached = undefined;
  }

  /** Every subcategory in the owner's order, each with its category. */
  subcategories(): Observable<CategorisedSubcategory[]> {
    return this.list().pipe(
      map((categories) =>
        categories.flatMap((category) =>
          category.subcategories.map((subcategory) => ({ category, subcategory })),
        ),
      ),
    );
  }
}
