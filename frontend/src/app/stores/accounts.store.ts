import { HttpClient } from '@angular/common/http';
import { Injectable, forwardRef, inject } from '@angular/core';
import type { ShareOption } from '@bankapp/shared';
import { type Observable, tap } from 'rxjs';
import { Invalidation } from './invalidation';

@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpAccountsStore) })
export abstract class AccountsStore {
  /** Marks an account as a savings account (followed by balance only), or clears it. */
  abstract setSavings(id: number, savings: boolean): Observable<void>;
  /** Hides an account from the overview and its transactions, or shows it again. */
  abstract setHidden(id: number, hidden: boolean): Observable<void>;
  /** Sets the share the owner bears of an account's transactions. */
  abstract setShare(id: number, share: ShareOption): Observable<void>;
}

@Injectable()
export class HttpAccountsStore extends AccountsStore {
  private readonly http = inject(HttpClient);
  private readonly invalidation = inject(Invalidation);

  setSavings(id: number, savings: boolean): Observable<void> {
    return this.http
      .put<void>(`/api/accounts/${id}/savings`, { savings })
      .pipe(tap(() => this.invalidation.fire('accounts')));
  }

  setHidden(id: number, hidden: boolean): Observable<void> {
    return this.http
      .put<void>(`/api/accounts/${id}/hidden`, { hidden })
      .pipe(tap(() => this.invalidation.fire('accounts')));
  }

  setShare(id: number, share: ShareOption): Observable<void> {
    return this.http
      .put<void>(`/api/accounts/${id}/share`, { share })
      .pipe(tap(() => this.invalidation.fire('accounts')));
  }
}
