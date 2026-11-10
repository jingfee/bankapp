import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Bank, BanksResponse } from '@bankapp/shared';
import { type Observable, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BanksService {
  private readonly http = inject(HttpClient);

  list(): Observable<Bank[]> {
    return this.http.get<BanksResponse>('/api/banks').pipe(map((response) => response.banks));
  }
}
