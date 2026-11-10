import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HealthService } from '../../health.service';

@Component({
  selector: 'app-home-page',
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 class="text-3xl font-semibold tracking-tight">Bankappen</h1>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">
          Dina konton och transaktioner på ett ställe.
        </p>
      </header>

      <section
        class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <p>Inga banker är anslutna ännu.</p>
      </section>

      <p
        class="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"
        aria-live="polite"
      >
        @switch (serverReachable()) {
          @case (true) {
            <span class="size-2 rounded-full bg-emerald-500" aria-hidden="true"></span> Servern
            svarar
          }
          @case (false) {
            <span class="size-2 rounded-full bg-red-500" aria-hidden="true"></span> Servern svarar
            inte
          }
          @default {
            <span class="size-2 rounded-full bg-zinc-400" aria-hidden="true"></span> Kontaktar
            servern…
          }
        }
      </p>
    </main>
  `,
})
export class HomePage {
  protected readonly serverReachable = toSignal(inject(HealthService).isServerReachable());
}
