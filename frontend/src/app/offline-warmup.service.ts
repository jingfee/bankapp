import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { OVERVIEW_VIEWS } from '@bankapp/shared';
import { LOGIN_PATH } from './auth/auth.guard';
import { monthOf, shiftMonth } from './dates';

/**
 * Fetches the main pages' reads in the background, so the service worker keeps them as saved
 * data and the pages work offline even if the owner did not open them recently (ADR 0017).
 * The URLs are the ones the stores ask for, query string included: that is what the service
 * worker saves a response under.
 */
@Injectable({ providedIn: 'root' })
export class OfflineWarmup {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private warmedUp = false;

  /**
   * Runs once each time the owner is in the app: when it starts, and again after the login page
   * has been shown, which means the owner was signed out in between.
   */
  watch(): void {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        if (event.urlAfterRedirects.startsWith(LOGIN_PATH)) {
          this.warmedUp = false;
        } else if (!this.warmedUp) {
          this.warmedUp = true;
          this.run();
        }
      });
  }

  /** Runs again when the app is back from being offline, if it ran before (the owner is in). */
  rerun(): void {
    if (this.warmedUp) this.run();
  }

  /**
   * Fetches everything now; a read that fails is simply not saved. Only for a signed-in owner:
   * signed out, every request would be refused with a 401.
   */
  run(): void {
    const month = monthOf(new Date());
    for (const target of [month, shiftMonth(month, -1)]) {
      for (const view of OVERVIEW_VIEWS) this.get('/api/overview', { month: target, view });
    }
    for (const url of [
      '/api/transactions',
      '/api/transactions/review',
      '/api/transactions/review/count',
      '/api/settlement',
      '/api/household-ratio',
      '/api/subcategory-shares',
      '/api/mortgage',
      '/api/mortgage/figures',
      '/api/savings',
      '/api/manual-savings-accounts',
      '/api/banks',
      '/api/accounts',
      '/api/categories',
    ]) {
      this.get(url);
    }
  }

  private get(url: string, params?: Record<string, string>): void {
    this.http.get(url, { params }).subscribe({ error: () => undefined });
  }
}
