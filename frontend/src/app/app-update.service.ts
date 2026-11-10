import { Injectable, InjectionToken, inject } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

/** Reloads the page; a token so tests can observe it without navigating. */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  factory: () => () => location.reload(),
});

/** Makes an installed app pick up a new deployment instead of staying on the cached version. */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly reloadPage = inject(RELOAD_PAGE);

  /** Once a new version has been downloaded, switches to it and reloads the app. */
  watch(): void {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((event) => event.type === 'VERSION_READY'))
      .subscribe(() => {
        void this.swUpdate.activateUpdate().then(() => this.reloadPage());
      });
  }
}
