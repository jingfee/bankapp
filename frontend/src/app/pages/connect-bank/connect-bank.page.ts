import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { Bank } from '@bankapp/shared';
import { catchError, map, of } from 'rxjs';
import { BanksService } from '../../banks.service';
import { ConnectionsService } from '../../connections.service';
import { Redirector } from '../../redirector';

type Loaded = { banks: Bank[] } | { failed: true };

@Component({
  selector: 'app-connect-bank-page',
  imports: [RouterLink],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <a routerLink="/" class="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
          >← Bankapp</a
        >
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Anslut bank</h1>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">Välj den bank du vill ansluta.</p>
      </header>

      <label class="flex flex-col gap-1 text-sm font-medium">
        Sök bank
        <input
          type="search"
          class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base font-normal dark:border-zinc-700 dark:bg-zinc-900"
          autocomplete="off"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
      </label>

      @if (startError(); as message) {
        <p role="alert">{{ message }}</p>
      }

      @let result = loaded();
      @if (!result) {
        <p aria-live="polite">Hämtar banker…</p>
      } @else if ('failed' in result) {
        <p role="alert">Banklistan kunde inte hämtas. Försök igen senare.</p>
      } @else if (result.banks.length === 0) {
        <p>Inga banker hittades ännu. Banklistan uppdateras varje natt.</p>
      } @else {
        @let visible = filtered();
        @if (visible.length === 0) {
          <p>Ingen bank matchar "{{ query() }}".</p>
        } @else {
          <ul
            class="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900"
          >
            @for (bank of visible; track bank.name) {
              <li class="flex items-center gap-3 px-4 py-3">
                @if (bank.logoUrl) {
                  <img [src]="bank.logoUrl" alt="" class="size-8 rounded object-contain" />
                } @else {
                  <span
                    class="size-8 rounded bg-zinc-200 dark:bg-zinc-800"
                    aria-hidden="true"
                  ></span>
                }
                <button
                  type="button"
                  class="flex-1 cursor-pointer text-left font-medium hover:underline disabled:opacity-50"
                  [disabled]="starting()"
                  (click)="connect(bank.name)"
                >
                  {{ bank.name }}
                </button>
                @if (bank.beta) {
                  <span
                    class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                    >Beta</span
                  >
                }
              </li>
            }
          </ul>
        }
      }
    </main>
  `,
})
export class ConnectBankPage {
  private readonly connections = inject(ConnectionsService);
  private readonly redirector = inject(Redirector);
  protected readonly query = signal('');
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | undefined>(undefined);
  protected readonly loaded = toSignal<Loaded>(
    inject(BanksService)
      .list()
      .pipe(
        map((banks): Loaded => ({ banks })),
        catchError(() => of<Loaded>({ failed: true })),
      ),
    { initialValue: undefined },
  );
  protected readonly filtered = computed(() => {
    const result = this.loaded();
    if (!result || 'failed' in result) return [];
    const needle = this.query().trim().toLocaleLowerCase('sv-SE');
    return result.banks.filter((bank) => bank.name.toLocaleLowerCase('sv-SE').includes(needle));
  });

  protected connect(bank: string): void {
    this.starting.set(true);
    this.startError.set(undefined);
    this.connections.start(bank).subscribe({
      next: (url) => this.redirector.goTo(url),
      error: (error: unknown) => {
        this.starting.set(false);
        this.startError.set(
          error instanceof HttpErrorResponse && error.status === 409
            ? `${bank} är redan ansluten.`
            : 'Anslutningen kunde inte startas. Försök igen senare.',
        );
      },
    });
  }
}
