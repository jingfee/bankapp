import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CategoriesResponse, Category } from '@bankapp/shared';
import { type Observable, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly http = inject(HttpClient);

  /** Every category with its subcategories, in the owner's order. */
  list(): Observable<Category[]> {
    return this.http
      .get<CategoriesResponse>('/api/categories')
      .pipe(map((response) => response.categories));
  }
}
