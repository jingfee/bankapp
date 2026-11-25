import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { isOfflineFailure } from '../offline/offline.service';

const KEY = 'bankapp:pending-logout';

/**
 * A logout made offline (ADR 0017): saved data is gone at once, but the server session still has
 * to be ended. The reminder lives in `localStorage` so it survives a restart, and is sent the
 * next time the device reaches the server. If the owner logs in again first, the reminder is
 * dropped (`clear`), so it never ends the new session; the old one simply expires.
 */
@Injectable({ providedIn: 'root' })
export class PendingLogout {
  private readonly http = inject(HttpClient);
  private sending = false;

  isPending(): boolean {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  }

  remember(): void {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Without storage the session is left to expire.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to forget.
    }
  }

  /**
   * Ends the server session if a logout is waiting. The reminder goes once the server has
   * answered, whatever it said: a 401 means the session was already gone. If it cannot be reached
   * the reminder stays for next time.
   */
  async send(): Promise<void> {
    if (this.sending || !this.isPending()) return;
    this.sending = true;
    try {
      await firstValueFrom(this.http.post<void>('/api/auth/logout', {}));
      this.clear();
    } catch (error) {
      if (!isOfflineFailure(error)) this.clear();
    } finally {
      this.sending = false;
    }
  }
}
