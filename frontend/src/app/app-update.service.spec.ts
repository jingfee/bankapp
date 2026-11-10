import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdateService, RELOAD_PAGE } from './app-update.service';

describe('AppUpdateService', () => {
  function setup(options: { serviceWorkerEnabled: boolean }) {
    const versionUpdates = new Subject<VersionEvent>();
    const calls: string[] = [];
    const swUpdate = {
      isEnabled: options.serviceWorkerEnabled,
      versionUpdates,
      activateUpdate: () => {
        calls.push('activate');
        return Promise.resolve(true);
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: swUpdate },
        { provide: RELOAD_PAGE, useValue: () => calls.push('reload') },
      ],
    });
    TestBed.inject(AppUpdateService).watch();
    return { versionUpdates, calls };
  }

  const versionReady: VersionEvent = {
    type: 'VERSION_READY',
    currentVersion: { hash: 'old' },
    latestVersion: { hash: 'new' },
  };

  it('switches to a newly deployed version and reloads the app onto it', async () => {
    const { versionUpdates, calls } = setup({ serviceWorkerEnabled: true });

    versionUpdates.next(versionReady);
    await Promise.resolve();

    expect(calls).toEqual(['activate', 'reload']);
  });

  it('ignores version events that are not a new version ready to use', async () => {
    const { versionUpdates, calls } = setup({ serviceWorkerEnabled: true });

    versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'new' } });
    await Promise.resolve();

    expect(calls).toEqual([]);
  });

  it('does nothing when the service worker is not active', async () => {
    const { versionUpdates, calls } = setup({ serviceWorkerEnabled: false });

    versionUpdates.next(versionReady);
    await Promise.resolve();

    expect(calls).toEqual([]);
  });
});
