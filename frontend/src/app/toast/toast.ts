import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

/** Renders the current toast; the app shell hosts one. */
@Component({
  selector: 'app-toast',
  template: `
    <div role="status" aria-live="polite">
      @if (toasts.message(); as message) {
        <div data-toast class="toast">{{ message }}</div>
      }
    </div>
  `,
})
export class Toast {
  protected readonly toasts = inject(ToastService);
}
