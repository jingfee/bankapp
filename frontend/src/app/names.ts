import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, Injector, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import type { PartyNames } from '@bankapp/shared';
import { filter } from 'rxjs';
import { LOGIN_PATH } from './auth/auth.guard';

/** What the owner and the partner are called until the server says otherwise. */
export const DEFAULT_NAMES: PartyNames = { owner: 'Jag', partner: 'Partner' };

const STORAGE_KEY = 'bankapp:names';

/**
 * What the UI calls the owner and the partner, from OWNER_NAME and PARTNER_NAME on the server.
 * Kept on the device too, so the names show at once on the next start and while offline.
 */
@Injectable({ providedIn: 'root' })
export class Names {
  private readonly injector = inject(Injector);
  private readonly current = signal<PartyNames>(readStored() ?? DEFAULT_NAMES);
  readonly names = this.current.asReadonly();
  private fetched = false;

  /** Fetches the names once the owner is in the app, and again after a new login. */
  watch(): void {
    this.injector
      .get(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.injector.get(DestroyRef)),
      )
      .subscribe((event) => {
        if (event.urlAfterRedirects.startsWith(LOGIN_PATH)) {
          this.fetched = false;
        } else if (!this.fetched) {
          this.fetched = true;
          this.fetch();
        }
      });
  }

  private fetch(): void {
    this.injector
      .get(HttpClient)
      .get<PartyNames>('/api/names')
      .subscribe({
        next: (names) => this.set(names),
        // Kept as they were; the next start tries again.
        error: () => (this.fetched = false),
      });
  }

  /** Forgets the names on the device, as logging out does with all saved data. */
  clear(): void {
    this.current.set(DEFAULT_NAMES);
    this.fetched = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to forget.
    }
  }

  /** Shows these names, and remembers them on the device. */
  set(names: PartyNames): void {
    this.current.set(names);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
    } catch {
      // Not remembered; they are fetched again on the next start.
    }
  }
}

function readStored(): PartyNames | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PartyNames>;
    return typeof value?.owner === 'string' && typeof value.partner === 'string'
      ? { owner: value.owner, partner: value.partner }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The owner's or the partner's name in the genitive, for "<…> del": _Kims_, _Lars_ (no extra s
 * after s, x or z). Without a name set it is _Din_ and _Partnerns_, lower-cased mid-sentence.
 */
export function possessive(
  names: PartyNames,
  who: keyof PartyNames,
  { midSentence = false } = {},
): string {
  const name = names[who];
  if (name === DEFAULT_NAMES[who]) {
    const word = who === 'owner' ? 'Din' : 'Partnerns';
    return midSentence ? word.toLowerCase() : word;
  }
  return /[sxz]$/i.test(name) ? name : `${name}s`;
}
