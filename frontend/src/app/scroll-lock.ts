import { DestroyRef, inject } from '@angular/core';

let locks = 0;
let previous = '';

/**
 * Stops the page behind a sheet from scrolling while the calling component lives. On mobile the
 * native date picker and keyboard move the visual viewport, and a scrolling page behind a fixed
 * sheet leaves it stranded. Call in an injection context; the lock is released on destroy.
 */
export function lockPageScroll(): void {
  if (locks++ === 0) {
    previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  inject(DestroyRef).onDestroy(() => {
    if (--locks === 0) document.body.style.overflow = previous;
  });
}
