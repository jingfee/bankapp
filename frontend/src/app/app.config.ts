import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  type ApplicationConfig,
  LOCALE_ID,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { AppUpdateService } from './app-update.service';
import { routes } from './app.routes';
import { APP_LOCALE } from './formatting/locale';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    provideHttpClient(withFetch()),
    { provide: LOCALE_ID, useValue: APP_LOCALE },
    // Only production builds run the service worker, so `ng serve` never serves stale files.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // Wait for the app to settle so the worker's downloads don't compete with the first load.
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideAppInitializer(() => inject(AppUpdateService).watch()),
  ],
};
