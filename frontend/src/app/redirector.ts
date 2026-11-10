import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/** Leaves the app for another address (the bank's BankID login); replaceable in tests. */
@Injectable({ providedIn: 'root' })
export class Redirector {
  private readonly document = inject(DOCUMENT);

  goTo(url: string): void {
    this.document.location.assign(url);
  }
}
