import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  SHARE_OPTIONS,
  type AccountType,
  type AccountsResponse,
  type BankAccounts,
  type ConnectedAccount,
  type ShareOption,
  type SyncSummary,
} from '@bankapp/shared';
import { BehaviorSubject, catchError, map, of, switchMap, takeWhile, tap, timer } from 'rxjs';
import { AccountsService } from '../../accounts.service';
import { ConnectionsService } from '../../connections.service';
import { APP_TIMEZONE, DateTimePipe } from '../../formatting/date-time.pipe';
import { MoneyPipe } from '../../formatting/money.pipe';
import { Redirector } from '../../redirector';
import { SyncService } from '../../sync.service';

type Loaded = AccountsResponse | { failed: true };

/** How often the page asks again while a sync is running. */
export const SYNC_POLL_INTERVAL_MS = 2000;

const DAY_MS = 24 * 3600 * 1000;

/** How long a bank connection is good for when it is made or renewed. */
const CONNECTION_DAYS = 90;

const DATE_TIME = new DateTimePipe();
const DAY_FORMAT = new Intl.DateTimeFormat('sv-SE', { timeZone: APP_TIMEZONE });
const TIME_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const VALID_UNTIL_FORMAT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: APP_TIMEZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const SHARE_LABELS: Record<ShareOption, string> = {
  me: 'Jag',
  half: '50/50',
  household: 'Hushåll',
  partner: 'Partner',
};

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  payment: 'Betalkonto',
  savings: 'Sparkonto',
  card: 'Kortkonto',
};

@Component({
  selector: 'app-banker-page',
  imports: [RouterLink, DateTimePipe, MoneyPipe],
  template: `
    <main class="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:py-10">
      @let result = loaded();
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-display text-3xl font-semibold tracking-tight">Banker</h1>
          @if (result && !('failed' in result)) {
            <p
              data-sync-status
              role="status"
              aria-live="polite"
              class="mt-1 flex items-center gap-2 text-sm text-muted"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                [class.animate-spin]="result.syncing"
                class="motion-reduce:animate-none"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
              <span>{{ statusText(result) }}</span>
            </p>
          }
        </div>
        <div class="flex items-center gap-2">
          @if (result && !('failed' in result) && result.banks.length > 0) {
            <button
              type="button"
              data-sync
              class="btn btn-secondary"
              [disabled]="result.syncing || manualSyncPending()"
              (click)="updateNow()"
            >
              Uppdatera
            </button>
          }
          <a routerLink="/anslut-bank" class="btn btn-primary">Anslut bank</a>
        </div>
      </header>

      @if (!result) {
        <p aria-live="polite">Hämtar konton…</p>
      } @else if ('failed' in result) {
        <p role="alert">Kontona kunde inte hämtas. Försök igen senare.</p>
      } @else if (result.banks.length === 0) {
        <section class="card p-6">
          <p>Inga banker är anslutna ännu.</p>
        </section>
      } @else {
        @if (summary(); as done) {
          @if (done.rateLimited) {
            <p role="alert" class="text-sm text-warning">
              Banken tillåter inte fler uppdateringar just nu.
              @if (lastSyncedAt(result); as at) {
                Senast uppdaterad {{ at | dateTime }}.
              }
            </p>
          }
          @if (done.failedAccounts > 0) {
            <p role="alert" class="text-sm text-warning">
              {{
                done.failedAccounts === 1
                  ? '1 konto kunde inte uppdateras.'
                  : done.failedAccounts + ' konton kunde inte uppdateras.'
              }}
            </p>
          }
        }
        @if (renewFailed()) {
          <p role="alert" class="text-sm text-danger">
            Förnyelsen kunde inte startas. Försök igen senare.
          </p>
        }
        @if (hideFailed()) {
          <p role="alert" class="text-sm text-danger">
            Kontot kunde inte ändras. Försök igen senare.
          </p>
        }
        @if (shareFailed(); as message) {
          <p role="alert" class="text-sm text-danger">{{ message }}</p>
        }
        @if (startFailed()) {
          <p role="alert" class="text-sm text-danger">
            Uppdateringen kunde inte startas. Försök igen senare.
          </p>
        }
        <div class="stagger grid items-start gap-4 lg:grid-cols-2">
          @for (group of result.banks; track group.bank) {
            <section [attr.data-bank]="group.bank" class="card flex flex-col gap-4 p-5">
              <div class="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  class="grid size-11 flex-none place-content-center rounded-xl bg-accent/15 font-display text-lg font-semibold text-accent"
                  >{{ monogram(group.bank) }}</span
                >
                <div class="min-w-0 flex-1">
                  <h2 class="truncate font-display text-lg font-semibold">{{ group.bank }}</h2>
                  <p data-account-count class="text-sm text-muted">
                    {{ accountCountText(group.accounts.length) }}
                  </p>
                </div>
                <button
                  type="button"
                  data-renew
                  class="btn btn-sm"
                  [class.btn-secondary]="group.status === 'active'"
                  [class.btn-primary]="group.status !== 'active'"
                  [disabled]="renewing()"
                  (click)="renew(group.bank, group.status === 'active')"
                >
                  Förnya
                </button>
              </div>

              <div data-validity [attr.data-status]="group.status">
                <div class="flex items-baseline justify-between gap-3 text-sm">
                  <span
                    data-days-left
                    [class.text-warning]="group.status !== 'active'"
                    [class.text-muted]="group.status === 'active'"
                    >{{ validityText(group) }}</span
                  >
                  <span class="text-muted">t.o.m. {{ validUntilText(group) }}</span>
                </div>
                <div class="meter mt-2" [class.meter-warning]="group.status !== 'active'">
                  <span [style.width.%]="meterPercent(group)"></span>
                </div>
                @if (group.status === 'expired') {
                  <p data-expiry role="alert" class="mt-2 text-sm text-warning">
                    Kopplingen till {{ group.bank }} har gått ut. Kontona uppdateras inte längre.
                  </p>
                } @else if (group.status === 'expiring') {
                  <p data-expiry class="mt-2 text-sm text-warning">
                    Kopplingen till {{ group.bank }} går ut om {{ daysLeftText(group) }}.
                  </p>
                }
              </div>

              <ul class="flex flex-col divide-y divide-line">
                @for (account of group.accounts; track account.id) {
                  <li
                    class="flex flex-col gap-3 py-3 first:pt-0 last:pb-0"
                    [attr.data-hidden-row]="account.hidden ? '' : null"
                  >
                    <div
                      class="flex items-start justify-between gap-3"
                      [class.opacity-55]="account.hidden"
                    >
                      <span class="flex min-w-0 flex-col">
                        <span data-account-name class="truncate font-medium">{{
                          account.name
                        }}</span>
                        <span class="text-sm text-muted">
                          {{ typeLabel(account.type) }} ·
                          <span class="amount" data-balance>{{
                            account.balance
                              ? (account.balance.amount | money: account.balance.currency)
                              : '–'
                          }}</span>
                        </span>
                      </span>
                      <span class="flex flex-none flex-col items-end text-xs text-muted">
                        <span data-synced>{{
                          account.lastSyncedAt
                            ? 'Uppdaterad ' + (account.lastSyncedAt | dateTime)
                            : 'Inte uppdaterad ännu'
                        }}</span>
                        @if (group.status === 'expired') {
                          <span class="text-warning" data-not-syncing>Uppdateras inte</span>
                        }
                      </span>
                    </div>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <label class="flex items-center gap-2 text-sm text-muted">
                        Andel
                        <select
                          data-share
                          class="input h-9 w-auto text-sm text-ink"
                          [value]="account.share"
                          [disabled]="savingShare()"
                          (change)="setShare(account, $event)"
                        >
                          @for (option of shareOptions; track option) {
                            <option [value]="option" [selected]="option === account.share">
                              {{ shareLabel(option) }}
                            </option>
                          }
                        </select>
                      </label>
                      <button
                        type="button"
                        data-toggle-hidden
                        class="btn btn-sm btn-secondary"
                        [class.border-dashed]="account.hidden"
                        [attr.aria-label]="
                          account.hidden ? 'Visa kontot igen' : 'Dölj kontot överallt'
                        "
                        [attr.title]="account.hidden ? 'Visa kontot igen' : 'Dölj kontot överallt'"
                        [disabled]="togglingHidden()"
                        (click)="setHidden(account.id, !account.hidden)"
                      >
                        <svg
                          aria-hidden="true"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          @if (account.hidden) {
                            <path
                              d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"
                            />
                            <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
                            <path
                              d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"
                            />
                            <path d="m2 2 20 20" />
                          } @else {
                            <path
                              d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
                            />
                            <circle cx="12" cy="12" r="3" />
                          }
                        </svg>
                        <span data-visibility>{{ account.hidden ? 'Dolt' : 'Visas' }}</span>
                      </button>
                    </div>
                  </li>
                }
              </ul>
              @if (group.closedAccounts.length > 0) {
                <div data-closed-accounts>
                  <h3 class="text-sm font-semibold text-muted">Avslutade konton</h3>
                  <ul class="mt-2 flex flex-col divide-y divide-line">
                    @for (account of group.closedAccounts; track account.id) {
                      <li class="flex items-center justify-between gap-3 py-2">
                        <span class="flex min-w-0 flex-col">
                          <span class="truncate">{{ account.name }}</span>
                          <span class="text-sm text-muted">{{ typeLabel(account.type) }}</span>
                        </span>
                        <span class="pill pill-neutral">Avslutat</span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </section>
          }
        </div>
      }
      <a routerLink="/andelar" data-andelar-link class="text-sm font-medium text-accent underline"
        >Andelar</a
      >
    </main>
  `,
})
export class BankerPage {
  private readonly accounts = inject(AccountsService);
  private readonly sync = inject(SyncService);
  private readonly connections = inject(ConnectionsService);
  private readonly redirector = inject(Redirector);
  protected readonly renewing = signal(false);
  protected readonly renewFailed = signal(false);
  protected readonly togglingHidden = signal(false);
  protected readonly hideFailed = signal(false);
  protected readonly savingShare = signal(false);
  protected readonly shareFailed = signal<string | null>(null);
  protected readonly shareOptions = SHARE_OPTIONS;
  /** Emits to start (or restart) fetching the accounts. */
  private readonly refresh = new BehaviorSubject<void>(undefined);
  /** What the page currently shows, kept across refreshes. */
  private shown: Loaded | undefined;
  /** True from the owner pressing Uppdatera until the page shows that sync has finished. */
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

  /** Starts a manual sync and follows it on the page. */
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

  /** Hides or shows an account; its transactions follow. */
  protected setHidden(id: number, hidden: boolean): void {
    this.togglingHidden.set(true);
    this.hideFailed.set(false);
    this.accounts.setHidden(id, hidden).subscribe({
      next: () => {
        this.togglingHidden.set(false);
        this.refresh.next();
      },
      error: () => {
        this.togglingHidden.set(false);
        this.hideFailed.set(true);
      },
    });
  }

  /** Saves the share chosen for an account, then fetches the accounts again. */
  protected setShare(account: ConnectedAccount, event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.savingShare.set(true);
    this.shareFailed.set(null);
    this.accounts.setShare(account.id, select.value as ShareOption).subscribe({
      next: () => {
        this.savingShare.set(false);
        this.refresh.next();
      },
      error: (error: unknown) => {
        this.savingShare.set(false);
        this.shareFailed.set(
          (error as { status?: number }).status === 409
            ? 'Hushåll kan väljas först när en hushållsandel har ställts in.'
            : 'Andelen kunde inte sparas. Försök igen senare.',
        );
        // Put the control back on what is stored.
        select.value = account.share;
      },
    });
  }

  protected shareLabel(option: ShareOption): string {
    return SHARE_LABELS[option];
  }

  /** Sends the owner to BankID to renew the bank's connection. */
  protected renew(bank: string, stillActive = false): void {
    this.renewing.set(true);
    this.renewFailed.set(false);
    this.connections.start(bank, stillActive).subscribe({
      next: (url) => this.redirector.goTo(url),
      error: () => {
        this.renewing.set(false);
        this.renewFailed.set(true);
      },
    });
  }

  /** The sync status under the heading: running, just finished, or when the data is from. */
  protected statusText(result: AccountsResponse): string {
    if (result.syncing) {
      return this.manualSyncPending() ? 'Uppdaterar…' : 'Första uppdateringen pågår…';
    }
    const done = this.summary();
    if (done) return `Uppdaterad nyss · ${this.newTransactionsText(done.newTransactions)}`;
    const at = this.lastSyncedAt(result);
    return at ? `Senast uppdaterad ${this.dayAndTime(at)}` : 'Inte uppdaterad ännu';
  }

  /** "idag 06:00" for today, otherwise the date and time. */
  private dayAndTime(timestamp: string): string {
    const day = (value: Date) => DAY_FORMAT.format(value);
    const date = new Date(timestamp);
    if (day(date) !== day(new Date())) return DATE_TIME.transform(timestamp);
    return `idag ${TIME_FORMAT.format(date)}`;
  }

  protected monogram(bank: string): string {
    return bank.trim().charAt(0).toLocaleUpperCase('sv-SE');
  }

  protected accountCountText(count: number): string {
    return count === 1 ? '1 konto' : `${count} konton`;
  }

  /** "Giltig i N dagar", "Går ut om N dagar" or "Utgången". */
  protected validityText(group: BankAccounts): string {
    if (group.status === 'expired') return 'Utgången';
    return group.status === 'expiring'
      ? `Går ut om ${this.daysLeftText(group)}`
      : `Giltig i ${this.daysLeftText(group)}`;
  }

  protected validUntilText(group: BankAccounts): string {
    return VALID_UNTIL_FORMAT.format(new Date(group.validUntil));
  }

  /** How much of a full connection period is left, for the meter. */
  protected meterPercent(group: BankAccounts): number {
    if (group.status === 'expired') return 0;
    const left = (Date.parse(group.validUntil) - Date.now()) / DAY_MS;
    return Math.min(100, Math.max(3, (left / CONNECTION_DAYS) * 100));
  }

  protected daysLeftText(group: BankAccounts): string {
    const days = Math.max(1, Math.ceil((Date.parse(group.validUntil) - Date.now()) / DAY_MS));
    return days === 1 ? '1 dag' : `${days} dagar`;
  }

  protected newTransactionsText(count: number): string {
    if (count === 0) return 'Inga nya transaktioner';
    return count === 1 ? '1 ny transaktion' : `${count} nya transaktioner`;
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
