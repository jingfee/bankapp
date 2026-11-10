import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { AccountType, AccountsResponse, BankAccounts, SyncSummary } from '@bankapp/shared';
import { BehaviorSubject, catchError, map, of, switchMap, takeWhile, tap, timer } from 'rxjs';
import { AccountsService } from '../../accounts.service';
import { ConnectionsService } from '../../connections.service';
import { DateTimePipe } from '../../formatting/date-time.pipe';
import { MoneyPipe } from '../../formatting/money.pipe';
import { HealthService } from '../../health.service';
import { Redirector } from '../../redirector';
import { SyncService } from '../../sync.service';

type Loaded = AccountsResponse | { failed: true };

/** How often the overview asks again while a sync is running. */
export const SYNC_POLL_INTERVAL_MS = 2000;

const DAY_MS = 24 * 3600 * 1000;

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  payment: 'Betalkonto',
  savings: 'Sparkonto',
  card: 'Kortkonto',
};

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, DateTimePipe, MoneyPipe],
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
        @if (result.syncing) {
          <p role="status" aria-live="polite" class="text-sm text-zinc-600 dark:text-zinc-400">
            {{ manualSyncPending() ? 'Uppdaterar…' : 'Första uppdateringen pågår…' }}
          </p>
        } @else if (summary(); as done) {
          <p role="status" aria-live="polite" class="text-sm text-zinc-600 dark:text-zinc-400">
            {{ newTransactionsText(done.newTransactions) }}
          </p>
          @if (done.rateLimited) {
            <p role="alert" class="text-sm text-amber-700 dark:text-amber-400">
              Banken tillåter inte fler uppdateringar just nu.
              @if (lastSyncedAt(result); as at) {
                Senast uppdaterad {{ at | dateTime }}.
              }
            </p>
          }
          @if (done.failedAccounts > 0) {
            <p role="alert" class="text-sm text-amber-700 dark:text-amber-400">
              {{
                done.failedAccounts === 1
                  ? '1 konto kunde inte uppdateras.'
                  : done.failedAccounts + ' konton kunde inte uppdateras.'
              }}
            </p>
          }
        }
        @if (renewFailed()) {
          <p role="alert" class="text-sm text-red-700 dark:text-red-400">
            Förnyelsen kunde inte startas. Försök igen senare.
          </p>
        }
        @if (startFailed()) {
          <p role="alert" class="text-sm text-red-700 dark:text-red-400">
            Uppdateringen kunde inte startas. Försök igen senare.
          </p>
        }
        <button
          type="button"
          data-sync
          class="self-start rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          [disabled]="result.syncing || manualSyncPending()"
          (click)="updateNow()"
        >
          Uppdatera
        </button>
        @for (group of result.banks; track group.bank) {
          <section
            [attr.data-bank]="group.bank"
            class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h2 class="text-lg font-semibold">{{ group.bank }}</h2>
            @if (group.status === 'active') {
              <p data-days-left class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Kopplingen går ut om {{ daysLeftText(group) }}.
              </p>
            }
            @if (group.status !== 'active') {
              <div
                data-expiry
                class="mt-3 flex flex-col gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              >
                <p [attr.role]="group.status === 'expired' ? 'alert' : null">
                  {{ expiryText(group) }}
                </p>
                <button
                  type="button"
                  class="self-start rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                  [disabled]="renewing()"
                  (click)="renew(group.bank)"
                >
                  Anslut igen
                </button>
              </div>
            }
            <ul class="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
              @for (account of group.accounts; track account.name) {
                <li class="flex items-baseline justify-between gap-3 py-2">
                  <span class="flex flex-col">
                    <span>{{ account.name }}</span>
                    <span class="text-sm text-zinc-500 dark:text-zinc-400">{{
                      typeLabel(account.type)
                    }}</span>
                  </span>
                  <span class="flex flex-col items-end">
                    <span class="font-medium tabular-nums" data-balance>{{
                      account.balance
                        ? (account.balance.amount | money: account.balance.currency)
                        : '–'
                    }}</span>
                    <span class="text-sm text-zinc-500 dark:text-zinc-400" data-synced>{{
                      account.lastSyncedAt
                        ? 'Uppdaterad ' + (account.lastSyncedAt | dateTime)
                        : 'Inte uppdaterad ännu'
                    }}</span>
                    @if (group.status === 'expired') {
                      <span class="text-sm text-amber-700 dark:text-amber-400" data-not-syncing
                        >Uppdateras inte</span
                      >
                    }
                  </span>
                </li>
              }
            </ul>
            @if (group.closedAccounts.length > 0) {
              <div data-closed-accounts class="mt-4">
                <h3 class="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                  Avslutade konton
                </h3>
                <ul class="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
                  @for (account of group.closedAccounts; track account.id) {
                    <li class="flex flex-col py-2">
                      <span>{{ account.name }}</span>
                      <span class="text-sm text-zinc-500 dark:text-zinc-400">{{
                        typeLabel(account.type)
                      }}</span>
                    </li>
                  }
                </ul>
              </div>
            }
          </section>
        }
        <a routerLink="/transaktioner" data-transactions-link class="font-medium underline"
          >Alla transaktioner</a
        >
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
  private readonly accounts = inject(AccountsService);
  private readonly sync = inject(SyncService);
  private readonly connections = inject(ConnectionsService);
  private readonly redirector = inject(Redirector);
  protected readonly renewing = signal(false);
  protected readonly renewFailed = signal(false);
  /** Emits to start (or restart) fetching the accounts. */
  private readonly refresh = new BehaviorSubject<void>(undefined);
  /** What the overview currently shows, kept across refreshes. */
  private shown: Loaded | undefined;
  /** True from the owner pressing Uppdatera until the overview shows that sync has finished. */
  protected readonly manualSyncPending = signal(false);
  /** How the sync the owner started went, once it has finished. */
  protected readonly summary = signal<SyncSummary | null>(null);
  protected readonly startFailed = signal(false);
  /** Fetches the accounts, and keeps fetching while a sync is running so balances appear. */
  protected readonly loaded = toSignal<Loaded>(
    this.refresh.pipe(
      switchMap(() =>
        timer(0, SYNC_POLL_INTERVAL_MS).pipe(
          switchMap(() =>
            this.accounts.list().pipe(
              map((response): Loaded => response),
              catchError(() => of<Loaded>({ failed: true })),
            ),
          ),
          tap((next) => {
            if (this.manualSyncPending() && !('failed' in next) && !next.syncing) {
              this.manualSyncPending.set(false);
              this.summary.set(next.lastSync);
            }
          }),
          // A failed refresh keeps what is already shown; only a failed first load is an error.
          map((next): Loaded => (this.shown && 'failed' in next ? this.shown : next)),
          tap((result) => (this.shown = result)),
          takeWhile(
            // A failed poll must not strand an owner who is waiting for their sync to finish.
            (result) => this.manualSyncPending() || (!('failed' in result) && result.syncing),
            true,
          ),
        ),
      ),
    ),
    { initialValue: undefined },
  );

  /** Starts a manual sync and follows it on the overview. */
  protected updateNow(): void {
    this.startFailed.set(false);
    this.summary.set(null);
    this.manualSyncPending.set(true);
    this.sync.start().subscribe({
      next: () => this.refresh.next(),
      error: () => {
        this.manualSyncPending.set(false);
        this.startFailed.set(true);
      },
    });
  }

  /** Sends the owner to BankID to renew the bank's connection. */
  protected renew(bank: string): void {
    this.renewing.set(true);
    this.renewFailed.set(false);
    this.connections.start(bank).subscribe({
      next: (url) => this.redirector.goTo(url),
      error: () => {
        this.renewing.set(false);
        this.renewFailed.set(true);
      },
    });
  }

  protected expiryText(group: BankAccounts): string {
    if (group.status === 'expired') {
      return `Kopplingen till ${group.bank} har gått ut. Kontona uppdateras inte längre.`;
    }
    return `Kopplingen till ${group.bank} går ut om ${this.daysLeftText(group)}.`;
  }

  protected daysLeftText(group: BankAccounts): string {
    const days = Math.max(1, Math.ceil((Date.parse(group.validUntil) - Date.now()) / DAY_MS));
    return days === 1 ? '1 dag' : `${days} dagar`;
  }

  protected newTransactionsText(count: number): string {
    if (count === 0) return 'Inga nya transaktioner.';
    return count === 1 ? '1 ny transaktion.' : `${count} nya transaktioner.`;
  }

  /** The most recent time any account was synced, i.e. how old the data shown is. */
  protected lastSyncedAt(result: AccountsResponse): string | null {
    const times = result.banks.flatMap((group) =>
      group.accounts.flatMap((account) => (account.lastSyncedAt ? [account.lastSyncedAt] : [])),
    );
    return times.length === 0 ? null : times.reduce((a, b) => (a > b ? a : b));
  }

  protected typeLabel(type: AccountType): string {
    return ACCOUNT_TYPE_LABELS[type];
  }
}
