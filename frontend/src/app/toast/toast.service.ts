import { Injectable, signal } from '@angular/core';

const VISIBLE_MS = 2500;

/** A short message at the bottom of the screen that goes away by itself. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly current = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly message = this.current.asReadonly();

  show(message: string): void {
    clearTimeout(this.timer);
    this.current.set(message);
    this.timer = setTimeout(() => this.current.set(null), VISIBLE_MS);
  }
}
