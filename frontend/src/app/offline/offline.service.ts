import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { LOGIN_PATH } from '../auth/auth.guard';
import { OfflineWarmup } from '../offline-warmup.service';
import { Invalidation } from '../stores/invalidation';

/** How long a request may take before the app decides the server cannot be reached. */
export const OFFLINE_TIMEOUT_MS = 3000;

/** How often an offline app asks the server whether it is back. */
export const RECHECK_INTERVAL_MS = 30_000;

const HEALTH_URL = '/api/health';

/**
 * Whether a failed request means the server cannot be reached or cannot answer (ADR 0017): no
 * response at all (status 0, which includes a timeout), or a 502, 503 or 504. Any other status
 * is the server answering, so it is an error and not offline.
 */
export function isOfflineFailure(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504)
  );
}

/**
 * What a form says when its save failed because the app is offline (ADR 0017). The form stays open
 * with what was entered; the owner can save once the app is back.
 */
export const OFFLINE_SAVE_MESSAGE =
  'Du är offline. Det du fyllt i finns kvar – spara när du är online igen.';

/** The message for a failed save: that the app is offline, or else the usual `fallback`. */
export function saveFailureMessage(error: unknown, fallback: string): string {
  return isOfflineFailure(error) ? OFFLINE_SAVE_MESSAGE : fallback;
}

/**
 * Whether the app is offline. Everything that needs to know reads `isOffline` from here: the
 * navigation, the pages and the interceptor that answers reads from saved data.
 *
 * The app goes offline when a request fails the way `isOfflineFailure` says, and is back when
 * `/api/health` answers. While offline it asks every 30 seconds, and at once when the app
 * returns to the foreground or the browser says it is online.
 */
@Injectable({ providedIn: 'root' })
export class Offline {
  private readonly invalidation = inject(Invalidation);
  private readonly warmup = inject(OfflineWarmup);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly offline = signal(false);
  readonly isOffline = this.offline.asReadonly();

  private timer: ReturnType<typeof setTimeout> | undefined;
  private checking = false;
  private started = false;

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.timer));
  }

  /**
   * Starts listening for the app coming back to the foreground and for the browser coming
   * online, and checks the server once the owner is in the app: the service worker answers a
   * read from saved data when the network is dead, so no request ever shows it.
   */
  watch(): void {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('online', this.onOnline);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('online', this.onOnline);
    });
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        if (this.started || event.urlAfterRedirects.startsWith(LOGIN_PATH)) return;
        this.started = true;
        void this.check();
      });
  }

  /** A request could not reach the server. Safe to call again while already offline. */
  markOffline(): void {
    if (this.offline()) return;
    this.offline.set(true);
    this.scheduleCheck();
  }

  /**
   * Asks the server whether it answers. Offline until it does; when it does after being offline,
   * every read is fetched again and the warm-up runs again.
   */
  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    clearTimeout(this.timer);
    let reachable: boolean;
    const abort = new AbortController();
    const giveUp = setTimeout(() => abort.abort(), OFFLINE_TIMEOUT_MS);
    try {
      // `no-store` skips the browser's cache; the service worker leaves /api/health alone because
      // it is in no data group of `ngsw-config.json` (caching.spec keeps it that way).
      const response = await fetch(HEALTH_URL, { cache: 'no-store', signal: abort.signal });
      reachable = ![502, 503, 504].includes(response.status);
    } catch {
      reachable = false;
    } finally {
      clearTimeout(giveUp);
      this.checking = false;
    }
    if (!reachable) {
      this.offline.set(true);
      this.scheduleCheck();
    } else if (this.offline()) {
      this.offline.set(false);
      this.invalidation.refreshAll();
      this.warmup.rerun();
    }
  }

  private scheduleCheck(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), RECHECK_INTERVAL_MS);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && this.offline()) void this.check();
  };

  private readonly onOnline = (): void => {
    if (this.offline()) void this.check();
  };
}
