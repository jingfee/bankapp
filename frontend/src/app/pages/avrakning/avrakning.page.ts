import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SettlementResponse } from '@bankapp/shared';
import { MoneyPipe } from '../../formatting/money.pipe';
import { balanceText } from '../../formatting/settlement-balance';
import { SettlementService } from '../../settlement.service';

type State = SettlementResponse | 'loading' | 'failed';

/** Today as `YYYY-MM-DD` in the owner's own time zone. */
function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/** The settlement balance, worked out live, and the settlement periods behind it (ADR 0008). */
@Component({
  selector: 'app-avrakning-page',
  imports: [RouterLink, MoneyPipe],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <header>
        <a routerLink="/" class="text-sm underline">Översikt</a>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight">Avräkning</h1>
      </header>

      @if (state() === 'loading') {
        <p aria-live="polite">Hämtar avräkning…</p>
      } @else if (state() === 'failed') {
        <p role="alert">Avräkningen kunde inte hämtas. Försök igen senare.</p>
      } @else {
        @if (current(); as data) {
          @if (data.balance === null) {
            <section
              data-switch-help
              class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 class="text-lg font-semibold">Ställ in saldot för att börja</h2>
              <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Ställ in saldot till partnerns andel av det som redan är betalt, per idag. Har
                partnerns senaste överföring också täckt räkningar som betalas de närmaste dagarna
                är saldot negativt tills de bokförs. Kommande fakturor räknas inte.
              </p>
            </section>
          } @else {
            <section
              data-balance-card
              class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <p class="text-sm text-zinc-500 dark:text-zinc-400">Avräkningssaldo</p>
              <p data-balance class="text-3xl font-semibold tabular-nums">
                {{ balanceLabel() }}
              </p>
            </section>
          }

          <form
            data-setting-form
            class="flex flex-wrap items-end gap-3"
            (submit)="$event.preventDefault(); save()"
          >
            <label class="flex flex-col text-sm">
              Saldo (kr)
              <input
                type="number"
                step="0.01"
                data-amount
                class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                [value]="amount()"
                (input)="amount.set(value($event))"
              />
            </label>
            <label class="flex flex-col text-sm">
              Per
              <input
                type="date"
                data-as-of
                class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                [value]="asOf()"
                (input)="asOf.set(value($event))"
              />
            </label>
            <button
              type="submit"
              data-save
              class="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              [disabled]="saving() || amount().trim() === '' || asOf() === ''"
            >
              Ställ in saldo
            </button>
          </form>
          @if (error(); as message) {
            <p role="alert" class="text-sm text-red-700 dark:text-red-400">{{ message }}</p>
          }

          @for (period of data.periods; track $index) {
            <section
              data-period
              class="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 data-period-title class="text-lg font-semibold">
                {{ period.closedOn === null ? 'Pågående period' : 'Avräknad ' + period.closedOn }}
              </h2>
              <dl class="mt-2 grid grid-cols-2 gap-x-3 text-sm">
                <dt class="text-zinc-500 dark:text-zinc-400">Ingående saldo</dt>
                <dd data-carried-in class="text-right tabular-nums">
                  {{ period.carriedIn | money }}
                </dd>
              </dl>
              @for (setting of period.balanceSettings; track $index) {
                <p data-period-setting class="mt-1 text-sm">
                  Saldo inställt per {{ setting.asOf }}: {{ setting.amount | money }}
                </p>
              }
              <ul class="mt-2 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                @for (item of period.items; track item.transactionId) {
                  <li data-item class="flex items-baseline justify-between gap-3 py-1.5">
                    <a [routerLink]="['/transaktioner', item.transactionId]" class="min-w-0">
                      <span class="block truncate">{{ item.description }}</span>
                      <span class="text-xs text-zinc-500 dark:text-zinc-400">
                        {{ item.date }} · {{ item.accountName }} · {{ item.amount | money }}
                      </span>
                    </a>
                    <span data-partner-part class="tabular-nums">
                      {{ item.partnerPart | money }}
                    </span>
                  </li>
                }
              </ul>
              <dl class="mt-2 grid grid-cols-2 gap-x-3 text-sm">
                @if (period.closedOn !== null) {
                  <dt class="text-zinc-500 dark:text-zinc-400">Betalt</dt>
                  <dd data-paid class="text-right tabular-nums">{{ period.paid | money }}</dd>
                }
                <dt class="text-zinc-500 dark:text-zinc-400">Utgående saldo</dt>
                <dd data-carried-out class="text-right font-medium tabular-nums">
                  {{ period.carriedOut | money }}
                </dd>
              </dl>
            </section>
          }
        }
      }
    </main>
  `,
})
export class AvrakningPage {
  private readonly service = inject(SettlementService);

  protected readonly state = signal<State>('loading');
  protected readonly current = computed(() => {
    const state = this.state();
    return typeof state === 'string' ? null : state;
  });
  protected readonly balanceLabel = computed(() => {
    const balance = this.current()?.balance;
    return balance === null || balance === undefined ? '' : balanceText(balance);
  });

  protected readonly amount = signal('');
  protected readonly asOf = signal(today());
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.service.get().subscribe({
      next: (response) => this.state.set(response),
      error: () => this.state.set('failed'),
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected save(): void {
    const amount = Number(this.amount().replace(',', '.'));
    if (!Number.isFinite(amount)) {
      this.error.set('Ange saldot som ett tal.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.service.setBalance({ amount, asOf: this.asOf() }).subscribe({
      next: (response) => {
        this.state.set(response);
        this.amount.set('');
        this.asOf.set(today());
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Saldot kunde inte sparas. Försök igen.');
        this.saving.set(false);
      },
    });
  }
}
