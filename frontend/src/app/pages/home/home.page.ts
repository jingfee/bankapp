import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { AccountType, BankAccounts } from '@bankapp/shared';
import { catchError, map, of } from 'rxjs';
import { AccountsService } from '../../accounts.service';
import { HealthService } from '../../health.service';

type Loaded = { banks: BankAccounts[] } | { failed: true };

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  payment: 'Betalkonto',
  savings: 'Sparkonto',
  card: 'Kortkonto',
};

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 class="text-3xl font-semibold tracking-tight">Bankapp</h1>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">
          Dina konton och transaktioner på ett ställe.
        </p>
      </header>

      @let result = loaded();
      @if (!result) {
        <p aria-live="polite">Hämtar konton…</p>
      } @else if ('failed' in result) {
        <p role="alert">Kontona kunde inte hämtas. Försök igen senare.</p>
      } @else if (result.banks.length === 0) {
        <section
          class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p>Inga banker är anslutna ännu.</p>
          <a routerLink="/anslut-bank" class="mt-4 inline-block font-medium underline"
            >Anslut bank</a
          >
        </section>
      } @else {
        @for (group of result.banks; track group.bank) {
          <section
            [attr.data-bank]="group.bank"
            class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 class="text-lg font-semibold">{{ group.bank }}</h2>
            <ul class="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
              @for (account of group.accounts; track account.name) {
                <li class="flex items-baseline justify-between gap-3 py-2">
                  <span>{{ account.name }}</span>
                  <span class="text-sm text-zinc-500 dark:text-zinc-400">{{
                    typeLabel(account.type)
                  }}</span>
                </li>
              }
            </ul>
          </section>
        }
        <a routerLink="/anslut-bank" class="font-medium underline">Anslut bank</a>
      }

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
  protected readonly loaded = toSignal<Loaded>(
    inject(AccountsService)
      .listByBank()
      .pipe(
        map((banks): Loaded => ({ banks })),
        catchError(() => of<Loaded>({ failed: true })),
      ),
    { initialValue: undefined },
  );

  protected typeLabel(type: AccountType): string {
    return ACCOUNT_TYPE_LABELS[type];
  }
}
