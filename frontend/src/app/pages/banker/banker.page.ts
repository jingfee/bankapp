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
import { Callout } from '../../callout/callout';
import { Confirm } from '../../confirm/confirm';
import { Menu, MenuItem } from '../../menu/menu';
import { Disclosure } from '../../disclosure/disclosure';
import { Empty } from '../../empty/empty';
import { Skeleton } from '../../skeleton/skeleton';
import { ConnectionsService } from '../../connections.service';
import { APP_TIMEZONE, DateTimePipe } from '../../formatting/date-time.pipe';
import { MoneyPipe } from '../../formatting/money.pipe';
import { Redirector } from '../../redirector';
import { ShareControl } from '../../share-control/share-control';
import { SyncService } from '../../sync.service';
import { SyncStatusService } from '../../sync-status.service';
import { Page } from '../../page/page';

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

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  payment: 'Betalkonto',
  savings: 'Sparkonto',
  card: 'Kortkonto',
};

@Component({
  selector: 'app-banker-page',
  imports: [
    RouterLink,
    Confirm,
    Menu,
    MenuItem,
    DateTimePipe,
    MoneyPipe,
    Page,
    ShareControl,
    Callout,
    Disclosure,
    Empty,
    Skeleton,
  ],
  template: `
    <app-page title="Banker">
      @let result = loaded();
      @if (result && !('failed' in result)) {
        <p
          page-subtitle
          data-sync-status
          role="status"
          aria-live="polite"
          class="flex items-center gap-2 text-sm text-muted"
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
      <div page-actions class="flex items-center gap-2">
        @if (result && !('failed' in result) && result.banks.length > 0) {
          <button
            type="button"
            data-sync
            class="btn btn-secondary max-sm:w-11 max-sm:px-0"
            [disabled]="result.syncing || manualSyncPending()"
            (click)="updateNow()"
          >
            <svg
              aria-hidden="true"
              class="size-5 sm:hidden"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
            <span class="max-sm:sr-only">Uppdatera</span>
          </button>
        }
        <a
          routerLink="/anslut-bank"
          class="btn btn-primary max-sm:w-11 max-sm:px-0"
          aria-label="Anslut bank"
        >
          <svg
            aria-hidden="true"
            class="size-5 sm:hidden"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span class="max-sm:sr-only">Anslut bank</span>
        </a>
      </div>

      @if (!result) {
        <div aria-busy="true" class="grid gap-4 lg:grid-cols-2">
          <app-skeleton shape="card" />
          <app-skeleton shape="card" />
        </div>
      } @else if ('failed' in result) {
        <app-callout variant="danger">Kontona kunde inte hämtas. Försök igen senare.</app-callout>
      } @else if (result.banks.length === 0) {
        <app-empty icon="landmark" text="Inga banker anslutna">
          <a empty-action routerLink="/anslut-bank" class="btn btn-primary">Anslut bank</a>
        </app-empty>
      } @else {
        @if (summary(); as done) {
          @if (done.rateLimited) {
            <app-callout variant="warning">
              Banken tillåter inte fler uppdateringar just nu.
              @if (lastSyncedAt(result); as at) {
                Senast uppdaterad {{ at | dateTime }}.
              }
            </app-callout>
          }
          @if (done.failedAccounts > 0) {
            <app-callout variant="warning">
              {{
                done.failedAccounts === 1
                  ? '1 konto kunde inte uppdateras.'
                  : done.failedAccounts + ' konton kunde inte uppdateras.'
              }}
            </app-callout>
          }
        }
        @if (renewFailed()) {
          <app-callout variant="danger">
            Förnyelsen kunde inte startas. Försök igen senare.
          </app-callout>
        }
        @if (hideFailed()) {
          <app-callout variant="danger">
            Kontot kunde inte ändras. Försök igen senare.
          </app-callout>
        }
        @if (shareFailed(); as message) {
          <app-callout variant="danger">{{ message }}</app-callout>
        }
        @if (removeFailed()) {
          <app-callout variant="danger">
            Banken kunde inte tas bort. Försök igen senare.
          </app-callout>
        }
        @if (startFailed()) {
          <app-callout variant="danger">
            Uppdateringen kunde inte startas. Försök igen senare.
          </app-callout>
        }
        <div class="stagger grid items-start gap-4 lg:grid-cols-2">
          @for (group of result.banks; track group.bank) {
            <section [attr.data-bank]="group.bank" class="card flex flex-col gap-4 p-4 sm:p-5">
              <div class="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  class="grid size-11 flex-none place-content-center rounded-xl bg-accent/15 font-display text-lg font-semibold text-accent"
                  >{{ monogram(group.bank) }}</span
                >
                <div class="min-w-0 flex-1">
                  <h2 class="card-title truncate">{{ group.bank }}</h2>
                  <p data-account-count class="text-sm text-muted">
                    {{ accountCountText(group.accounts.length) }}
                  </p>
                </div>
                @if (group.status !== 'active') {
                  <button
                    type="button"
                    data-renew
                    class="btn btn-sm btn-primary flex-none"
                    [disabled]="renewing()"
                    (click)="renew(group.bank, false)"
                  >
                    Förnya
                  </button>
                }
                <app-menu [label]="'Fler val för ' + group.bank" data-bank-menu>
                  @if (group.status === 'active') {
                    <button
                      appMenuItem
                      type="button"
                      data-renew
                      [disabled]="renewing()"
                      (click)="renew(group.bank, true)"
                    >
                      Förnya
                    </button>
                  }
                  <button
                    appMenuItem
                    type="button"
                    data-remove-bank
                    [danger]="true"
                    [disabled]="removing()"
                    (click)="startRemove(group)"
                  >
                    Ta bort bank…
                  </button>
                </app-menu>
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
                  <app-callout data-expiry variant="danger" class="mt-3">
                    Kopplingen till {{ group.bank }} har gått ut. Kontona uppdateras inte längre.
                  </app-callout>
                } @else if (group.status === 'expiring') {
                  <app-callout data-expiry variant="warning" class="mt-3">
                    Kopplingen till {{ group.bank }} går ut om {{ daysLeftText(group) }}.
                  </app-callout>
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
                          {{ account.savings ? 'Sparkonto' : typeLabel(account.type) }} ·
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
                      <span class="flex items-center gap-2 text-sm text-muted">
                        Andel
                        <app-share-control
                          label="Andel"
                          [value]="account.share"
                          [disabled]="savingShare()"
                          (changed)="setShare(account, $event)"
                        />
                      </span>
                    </div>
                    <div class="flex flex-col gap-2">
                      <label
                        class="flex items-center justify-between gap-3 text-sm"
                        title="Följ bara saldot, transaktionerna visas inte"
                      >
                        <span>Följ som sparkonto</span>
                        <input
                          type="checkbox"
                          role="switch"
                          class="switch"
                          data-toggle-savings
                          [checked]="account.savings"
                          [disabled]="togglingHidden()"
                          (change)="setSavings(account.id, !account.savings)"
                        />
                      </label>
                      <label class="flex items-center justify-between gap-3 text-sm">
                        <span>Visas överallt</span>
                        <input
                          type="checkbox"
                          role="switch"
                          class="switch"
                          data-toggle-hidden
                          [checked]="!account.hidden"
                          [disabled]="togglingHidden()"
                          (change)="setHidden(account.id, !account.hidden)"
                        />
                      </label>
                    </div>
                  </li>
                }
              </ul>
              @if (group.closedAccounts.length > 0) {
                <div data-closed-accounts>
                  <h3 class="card-title">Avslutade konton</h3>
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
      @if (result && !('failed' in result) && result.removedBanks.length > 0) {
        <div data-removed-banks class="card p-4 sm:p-5">
          <app-disclosure
            label="Borttagna banker"
            [count]="result.removedBanks.length"
            [title]="true"
          >
            <div class="flex flex-col gap-5">
              @if (deleteFailed()) {
                <app-callout variant="danger">
                  Banken kunde inte tas bort helt. Försök igen senare.
                </app-callout>
              }
              @for (removed of result.removedBanks; track removed.bank) {
                <section [attr.data-removed-bank]="removed.bank" class="flex flex-col gap-2">
                  <h3 class="font-medium">{{ removed.bank }}</h3>
                  <ul class="flex flex-col divide-y divide-line">
                    @for (account of removed.accounts; track account.id) {
                      <li
                        class="flex items-center justify-between gap-3 py-2"
                        [attr.data-hidden-row]="account.hidden ? '' : null"
                      >
                        <span class="flex min-w-0 flex-col" [class.opacity-55]="account.hidden">
                          <span data-account-name class="truncate">{{ account.name }}</span>
                          <span class="text-sm text-muted">{{ typeLabel(account.type) }}</span>
                        </span>
                        <label class="flex flex-none items-center gap-3 text-sm">
                          <span>Visas</span>
                          <input
                            type="checkbox"
                            role="switch"
                            class="switch"
                            data-toggle-hidden
                            [attr.aria-label]="'Visa ' + account.name"
                            [checked]="!account.hidden"
                            [disabled]="togglingHidden()"
                            (change)="setHidden(account.id, !account.hidden)"
                          />
                        </label>
                      </li>
                    }
                  </ul>
                  <button
                    type="button"
                    data-delete-bank
                    class="btn btn-sm btn-danger-soft self-start"
                    (click)="startDelete(removed.bank)"
                  >
                    Ta bort helt…
                  </button>
                </section>
              }
            </div>
          </app-disclosure>
        </div>
      }
    </app-page>

    @if (removingBank(); as group) {
      <app-confirm
        [heading]="'Ta bort ' + group.bank + '?'"
        message="Kontona uppdateras inte längre, men historiken finns kvar och du kan ansluta banken igen."
        confirmLabel="Ta bort bank"
        [busy]="removing()"
        (confirmed)="removeBank(group)"
        (cancelled)="removingBank.set(null)"
      >
        @for (account of savingsOf(group); track account.id) {
          <label class="check-card">
            <input
              type="checkbox"
              class="accent-(--color-accent)"
              [attr.data-continue-account]="account.id"
              [checked]="continuing().has(account.id)"
              (change)="toggleContinue(account.id)"
            />
            <span>Fortsätt följa saldot på {{ account.name }} manuellt</span>
          </label>
        }
      </app-confirm>
    }

    @if (confirmingDelete(); as bank) {
      <app-confirm
        [heading]="'Ta bort ' + bank + ' helt?'"
        [message]="
          bank +
          ' raderas helt och för alltid: banken, dess konton, alla transaktioner och saldohistoriken. Månader du redan sett och uppgörelsen kan ändras. Sparkonton som du fortsatt följa manuellt tas inte bort.'
        "
        confirmLabel="Ta bort helt"
        [busy]="deleting()"
        [confirmDisabled]="typedName().trim() !== bank"
        (confirmed)="deleteBank(bank)"
        (cancelled)="confirmingDelete.set(null)"
      >
        <label class="flex flex-col gap-1 text-sm">
          Skriv bankens namn för att bekräfta
          <span class="field">
            <input
              #name
              data-delete-name
              data-autofocus
              type="text"
              autocomplete="off"
              class="field-control"
              [value]="typedName()"
              (input)="typedName.set(name.value)"
            />
          </span>
        </label>
      </app-confirm>
    }
  `,
})
export class BankerPage {
  private readonly accounts = inject(AccountsService);
  private readonly sync = inject(SyncService);
  private readonly syncStatus = inject(SyncStatusService);
  private readonly connections = inject(ConnectionsService);
  private readonly redirector = inject(Redirector);
  /** The bank the owner is removing, awaiting confirmation. */
  protected readonly removingBank = signal<BankAccounts | null>(null);
  /** The savings accounts of that bank that carry on by hand, by id. */
  protected readonly continuing = signal<ReadonlySet<number>>(new Set());
  protected readonly renewing = signal(false);
  protected readonly renewFailed = signal(false);
  protected readonly removing = signal(false);
  protected readonly removeFailed = signal(false);
  protected readonly deleting = signal(false);
  protected readonly confirmingDelete = signal<string | null>(null);
  protected readonly typedName = signal('');
  protected readonly deleteFailed = signal(false);
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
          tap((result) => this.reportStatus(result)),
          takeWhile(
            // A failed poll must not strand an owner who is waiting for their sync to finish.
            (result) =>
              this.manualSyncPending() || (!('failed' in result) && result.syncing !== null),
            true,
          ),
        ),
      ),
    ),
    { initialValue: undefined },
  );

  private reportStatus(result: Loaded): void {
    if ('failed' in result) return;
    this.syncStatus.report({
      lastSyncedAt: this.lastSyncedAt(result),
      failed:
        !!result.lastSync && (result.lastSync.failedAccounts > 0 || result.lastSync.rateLimited),
      expiring: result.banks.filter((group) => group.status !== 'active').length,
    });
  }

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

  /** Marks or unmarks an account as a savings account; its transactions follow. */
  protected setSavings(id: number, savings: boolean): void {
    this.togglingHidden.set(true);
    this.hideFailed.set(false);
    this.accounts.setSavings(id, savings).subscribe({
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
  protected setShare(account: ConnectedAccount, option: ShareOption): void {
    if (account.share === option) return;
    this.savingShare.set(true);
    this.shareFailed.set(null);
    this.accounts.setShare(account.id, option).subscribe({
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
      },
    });
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

  protected savingsOf(group: BankAccounts): ConnectedAccount[] {
    return group.accounts.filter((account) => account.savings);
  }

  /** Opens the confirmation; each savings account starts out continuing by hand. */
  protected startRemove(group: BankAccounts): void {
    this.continuing.set(new Set(this.savingsOf(group).map((account) => account.id)));
    this.removingBank.set(group);
  }

  protected toggleContinue(id: number): void {
    this.continuing.update((all) => {
      const next = new Set(all);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /**
   * Removes a bank after the owner confirms: it stops syncing, its history stays and it can be
   * connected again (_Ta bort bank_). Each savings account either carries on by hand or closes
   * from today.
   */
  protected removeBank(group: BankAccounts): void {
    const continueManually = this.savingsOf(group)
      .filter((account) => this.continuing().has(account.id))
      .map((account) => account.id);
    this.removing.set(true);
    this.removeFailed.set(false);
    this.connections.remove(group.bank, continueManually).subscribe({
      next: () => {
        this.removing.set(false);
        this.removingBank.set(null);
        this.refresh.next();
      },
      error: () => {
        this.removing.set(false);
        this.removingBank.set(null);
        this.removeFailed.set(true);
      },
    });
  }

  protected startDelete(bank: string): void {
    this.typedName.set('');
    this.deleteFailed.set(false);
    this.confirmingDelete.set(bank);
  }

  /**
   * Erases a removed bank and everything it brought in, once the owner has typed its name
   * (_Ta bort helt_, ADR 0013).
   */
  protected deleteBank(bank: string): void {
    if (this.typedName().trim() !== bank) return;
    this.deleting.set(true);
    this.deleteFailed.set(false);
    this.connections.deleteForGood(bank).subscribe({
      next: () => {
        this.deleting.set(false);
        this.confirmingDelete.set(null);
        this.refresh.next();
      },
      error: () => {
        this.deleting.set(false);
        this.confirmingDelete.set(null);
        this.deleteFailed.set(true);
      },
    });
  }

  /** The sync status under the heading: running, just finished, or when the data is from. */
  protected statusText(result: AccountsResponse): string {
    if (result.syncing) {
      return result.syncing === 'initial' ? 'Första uppdateringen pågår…' : 'Uppdaterar…';
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
