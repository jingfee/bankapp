import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
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
import { authInterceptor } from './auth/auth.interceptor';
import { AppUpdateService } from './app-update.service';
import { routes } from './app.routes';
import { Names } from './names';
import { OfflineWarmup } from './offline-warmup.service';
import { offlineInterceptor } from './offline/offline.interceptor';
import { Offline } from './offline/offline.service';
import { APP_LOCALE } from './formatting/locale';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor, offlineInterceptor])),
    { provide: LOCALE_ID, useValue: APP_LOCALE },
    // Only production builds run the service worker, so `ng serve` never serves stale files.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // Wait for the app to settle so the worker's downloads don't compete with the first load.
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideAppInitializer(() => inject(AppUpdateService).watch()),
    provideAppInitializer(() => inject(OfflineWarmup).watch()),
    provideAppInitializer(() => inject(Offline).watch()),
    provideAppInitializer(() => inject(Names).watch()),
  ],
};
