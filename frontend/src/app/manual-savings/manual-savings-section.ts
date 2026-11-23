import { ShortDatePipe } from '../formatting/short-date.pipe';
import { Component, computed, inject, signal } from '@angular/core';
import type { BalanceEntry, ManualSavingsAccount } from '@bankapp/shared';
import type { Observable } from 'rxjs';
import { today } from '../dates';
import { Callout } from '../callout/callout';
import { Confirm } from '../confirm/confirm';
import { Menu, MenuItem } from '../menu/menu';
import { Sheet } from '../sheet/sheet';
import { Empty } from '../empty/empty';
import { Icon } from '../icon/icon';
import { DateField } from '../date-field/date-field';
import { formatAmountInput, parseAmount } from '../formatting/amount';
import { MoneyPipe } from '../formatting/money.pipe';
import { SavingsStore } from '../stores/savings.store';

/** Manuella sparkonton: savings accounts the app cannot reach, such as an ISK, kept up to date by hand. */
@Component({
  selector: 'app-manual-savings-section',
  imports: [
    ShortDatePipe,
    DateField,
    MoneyPipe,
    Callout,
    Confirm,
    Empty,
    Icon,
    Menu,
    MenuItem,
    Sheet,
  ],
  template: `
    <section data-manual-savings class="card flex flex-col gap-4 p-4 sm:p-5">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title">Manuella sparkonton</h2>
        <button
          type="button"
          data-open-add-account
          class="btn btn-sm btn-secondary"
          (click)="openAdd()"
        >
          <app-icon name="plus" [size]="16" />
          Lägg till sparkonto
        </button>
      </div>

      @if (failed(); as message) {
        <app-callout variant="danger">{{ message }}</app-callout>
      }

      @let list = accounts();
      @if (list.length === 0) {
        <app-empty
          icon="piggy-bank"
          text="Inga manuella sparkonton ännu. Lägg till t.ex. en ISK och ange saldot då och då."
        />
      }
      <ul class="flex flex-col divide-y divide-line">
        @for (account of list; track account.id) {
          <li
            class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
            [attr.data-manual-account]="account.id"
          >
            <div class="flex items-start justify-between gap-3">
              <span class="flex min-w-0 flex-col">
                <span data-manual-name class="truncate font-medium">{{ account.name }}</span>
                <span class="text-sm text-muted">
                  {{ account.institution ?? 'Sparkonto' }}
                  @if (account.closedOn) {
                    · <span data-closed>Avslutat {{ account.closedOn | shortDate }}</span>
                  } @else if (account.balance === null) {
                    · <span>Ingen saldonotering ännu</span>
                  }
                </span>
              </span>
              <app-menu [label]="'Åtgärder för ' + account.name">
                <button appMenuItem type="button" data-rename (click)="startRename(account)">
                  Byt namn
                </button>
                @if (account.closedOn) {
                  <button
                    appMenuItem
                    type="button"
                    data-reopen
                    [disabled]="busy()"
                    (click)="reopen(account)"
                  >
                    Öppna igen
                  </button>
                } @else {
                  <button
                    appMenuItem
                    type="button"
                    data-close
                    (click)="closingId.set(account.id); closeDate.set(today())"
                  >
                    Avsluta…
                  </button>
                }
              </app-menu>
            </div>

            @if (!account.closedOn) {
              <div>
                <button
                  type="button"
                  data-new-entry
                  class="btn btn-sm btn-secondary"
                  (click)="startEntry(account)"
                >
                  Ny saldonotering
                </button>
              </div>
            }

            @if (account.entries.length > 0) {
              <ul class="flex flex-col divide-y divide-line text-sm" data-entries>
                @for (entry of account.entries; track entry.id) {
                  <li class="flex items-center justify-between gap-3 py-2" data-entry>
                    <span class="flex flex-wrap gap-x-3">
                      <span data-entry-day>{{ entry.date | shortDate }}</span>
                      <span class="amount">{{ entry.balance | money }}</span>
                      <span class="text-muted">
                        {{ entry.netDeposits === null ? 'Insatt –' : 'Insatt ' }}
                        @if (entry.netDeposits !== null) {
                          <span class="amount">{{ entry.netDeposits | money }}</span>
                        }
                      </span>
                    </span>
                    <app-menu [label]="'Åtgärder för saldonoteringen ' + (entry.date | shortDate)">
                      <button
                        appMenuItem
                        type="button"
                        data-edit-entry
                        (click)="startEntry(account, entry)"
                      >
                        Ändra
                      </button>
                      <button
                        appMenuItem
                        type="button"
                        data-delete-entry
                        [danger]="true"
                        [disabled]="busy()"
                        (click)="deleting.set({ account, entry })"
                      >
                        Ta bort…
                      </button>
                    </app-menu>
                  </li>
                }
              </ul>
            }
          </li>
        }
      </ul>
    </section>

    @if (adding() || renamingAccount()) {
      <app-sheet
        data-account-form
        [heading]="renamingAccount() ? 'Byt namn' : 'Lägg till sparkonto'"
        [dismissible]="!busy()"
        (closed)="closeAccountForm()"
        (submitted)="saveAccount()"
      >
        <label class="flex flex-col gap-1 text-sm text-muted">
          Namn
          <span class="field"
            ><input
              data-account-name-input
              data-rename-input
              data-autofocus
              class="field-control"
              [value]="name()"
              (input)="name.set(value($event))"
          /></span>
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted">
          Bank eller förvaltare (valfritt)
          <span class="field"
            ><input
              data-institution-input
              class="field-control"
              [value]="institution()"
              (input)="institution.set(value($event))"
          /></span>
        </label>
        @if (failed(); as message) {
          <app-callout variant="danger">{{ message }}</app-callout>
        }
        <ng-container sheet-footer>
          <button type="button" class="btn btn-ghost" (click)="closeAccountForm()">Avbryt</button>
          <button
            type="submit"
            data-save-account
            data-save-rename
            class="btn btn-primary flex-1"
            [disabled]="busy() || name().trim() === ''"
          >
            Spara
          </button>
        </ng-container>
      </app-sheet>
    }

    @if (closingAccount(); as account) {
      <app-sheet
        data-close-form
        [heading]="'Avsluta ' + account.name"
        [dismissible]="!busy()"
        (closed)="closingId.set(null)"
        (submitted)="close(account)"
      >
        <label class="flex flex-col gap-1 text-sm text-muted">
          Avslutat den
          <app-date-field [value]="closeDate()" (valueChange)="closeDate.set($event)" />
        </label>
        @if (failed(); as message) {
          <app-callout variant="danger">{{ message }}</app-callout>
        }
        <ng-container sheet-footer>
          <button type="button" class="btn btn-ghost" (click)="closingId.set(null)">Avbryt</button>
          <button
            type="submit"
            data-confirm-close
            class="btn btn-primary flex-1"
            [disabled]="busy() || closeDate() === ''"
          >
            Avsluta konto
          </button>
        </ng-container>
      </app-sheet>
    }

    @if (entryAccount(); as account) {
      <app-sheet
        data-entry-form
        [heading]="editingEntry() ? 'Ändra saldonotering' : 'Ny saldonotering'"
        [dismissible]="!busy()"
        (closed)="entryFormFor.set(null)"
        (submitted)="saveEntry(account)"
      >
        <label class="flex flex-col gap-1 text-sm text-muted">
          Datum
          <app-date-field
            data-entry-date
            [value]="entryDate()"
            (valueChange)="entryDate.set($event)"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted">
          Saldo
          <span class="field">
            <input
              type="text"
              inputmode="decimal"
              data-entry-balance
              data-autofocus
              class="field-control"
              [value]="entryBalance()"
              (input)="entryBalance.set(value($event))"
            />
            <span class="field-suffix">kr</span>
          </span>
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted">
          Insatt (valfritt)
          <span class="field">
            <input
              type="text"
              inputmode="decimal"
              data-entry-deposits
              class="field-control"
              [value]="entryDeposits()"
              (input)="entryDeposits.set(value($event))"
            />
            <span class="field-suffix">kr</span>
          </span>
          <span class="text-xs">Som det står hos banken</span>
        </label>
        @if (entryError(); as message) {
          <app-callout data-entry-error variant="danger">{{ message }}</app-callout>
        }
        <ng-container sheet-footer>
          <button
            type="button"
            data-cancel-entry
            class="btn btn-ghost"
            (click)="entryFormFor.set(null)"
          >
            Avbryt
          </button>
          <button type="submit" data-save-entry class="btn btn-primary flex-1" [disabled]="busy()">
            Spara
          </button>
        </ng-container>
      </app-sheet>
    }

    @if (deleting(); as pending) {
      <app-confirm
        heading="Ta bort saldonoteringen?"
        [message]="
          'Saldonoteringen ' +
          (pending.entry.date | shortDate) +
          ' på ' +
          pending.account.name +
          ' tas bort.'
        "
        confirmLabel="Ta bort"
        [busy]="busy()"
        (confirmed)="deleteEntry(pending.account, pending.entry)"
        (cancelled)="deleting.set(null)"
      />
    }
  `,
})
export class ManualSavingsSection {
  private readonly store = inject(SavingsStore);
  private readonly read = this.store.manualSavings();
  protected readonly today = today;

  /** The accounts as last fetched; the `savings` fact every change fires fetches them again. */
  protected readonly accounts = computed<ManualSavingsAccount[]>(
    () => this.read.value()?.accounts ?? [],
  );
  private readonly actionFailed = signal<string | null>(null);
  protected readonly failed = computed(() =>
    this.read.failed() ? 'Sparkontona kunde inte hämtas. Försök igen senare.' : this.actionFailed(),
  );
  protected readonly busy = signal(false);

  protected readonly adding = signal(false);
  protected readonly name = signal('');
  protected readonly institution = signal('');
  protected readonly renamingId = signal<number | null>(null);
  protected readonly closingId = signal<number | null>(null);
  protected readonly closeDate = signal(today());

  protected readonly entryFormFor = signal<number | null>(null);
  /** The entry being corrected, or null when a new one is being made. */
  protected readonly editingEntry = signal<BalanceEntry | null>(null);
  /** The entry waiting for the owner to confirm its removal. */
  protected readonly deleting = signal<{
    account: ManualSavingsAccount;
    entry: BalanceEntry;
  } | null>(null);

  protected readonly renamingAccount = computed(
    () => this.accounts().find((a) => a.id === this.renamingId()) ?? null,
  );
  protected readonly closingAccount = computed(
    () => this.accounts().find((a) => a.id === this.closingId()) ?? null,
  );
  protected readonly entryAccount = computed(
    () => this.accounts().find((a) => a.id === this.entryFormFor()) ?? null,
  );
  protected readonly entryDate = signal(today());
  protected readonly entryBalance = signal('');
  protected readonly entryDeposits = signal('');
  protected readonly entryError = signal<string | null>(null);

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected createAccount(): void {
    this.run(
      this.store.create(this.request()),
      (created) => {
        this.adding.set(false);
        this.name.set('');
        this.institution.set('');
        this.startEntry(created);
      },
      'Kontot kunde inte sparas. Försök igen senare.',
    );
  }

  protected openAdd(): void {
    this.name.set('');
    this.institution.set('');
    this.renamingId.set(null);
    this.actionFailed.set(null);
    this.adding.set(true);
  }

  protected closeAccountForm(): void {
    this.name.set('');
    this.institution.set('');
    this.actionFailed.set(null);
    this.adding.set(false);
    this.renamingId.set(null);
  }

  /** The account sheet adds a new account, or renames the one it was opened for. */
  protected saveAccount(): void {
    const account = this.renamingAccount();
    if (account === null) this.createAccount();
    else this.rename(account);
  }

  protected startRename(account: ManualSavingsAccount): void {
    this.name.set(account.name);
    this.institution.set(account.institution ?? '');
    this.adding.set(false);
    this.actionFailed.set(null);
    this.renamingId.set(account.id);
  }

  protected rename(account: ManualSavingsAccount): void {
    this.run(
      this.store.rename(account.id, this.request()),
      () => {
        this.renamingId.set(null);
      },
      'Namnet kunde inte sparas. Försök igen senare.',
    );
  }

  protected close(account: ManualSavingsAccount): void {
    this.run(
      this.store.close(account.id, { date: this.closeDate() }),
      () => {
        this.closingId.set(null);
        if (this.entryFormFor() === account.id) this.entryFormFor.set(null);
      },
      'Kontot kunde inte avslutas. Försök igen senare.',
    );
  }

  protected reopen(account: ManualSavingsAccount): void {
    this.run(
      this.store.reopen(account.id),
      () => undefined,
      'Kontot kunde inte öppnas igen. Försök igen senare.',
    );
  }

  /** Opens the entry form for a new entry, or for correcting `entry`. */
  protected startEntry(account: ManualSavingsAccount, entry: BalanceEntry | null = null): void {
    this.editingEntry.set(entry);
    this.entryError.set(null);
    this.entryDate.set(entry?.date ?? today());
    this.entryBalance.set(entry ? formatAmountInput(entry.balance) : '');
    this.entryDeposits.set(entry?.netDeposits != null ? formatAmountInput(entry.netDeposits) : '');
    this.entryFormFor.set(account.id);
  }

  protected saveEntry(account: ManualSavingsAccount): void {
    const balance = parseAmount(this.entryBalance());
    const depositsText = this.entryDeposits().trim();
    const netDeposits = depositsText === '' ? null : parseAmount(depositsText);
    if (balance === null) {
      this.entryError.set('Ange saldot som ett belopp, t.ex. 409 500.');
      return;
    }
    if (depositsText !== '' && netDeposits === null) {
      this.entryError.set('Ange insatt som ett belopp, eller lämna det tomt.');
      return;
    }
    if (this.entryDate() === '') {
      this.entryError.set('Ange ett datum.');
      return;
    }
    if (this.entryDate() > today()) {
      this.entryError.set('Datumet kan inte vara i framtiden.');
      return;
    }
    this.entryError.set(null);
    const request = { date: this.entryDate(), balance, netDeposits };
    const editing = this.editingEntry();
    this.busy.set(true);
    (editing
      ? this.store.updateEntry(account.id, editing.id, request)
      : this.store.addEntry(account.id, request)
    ).subscribe({
      next: () => {
        this.busy.set(false);
        this.entryFormFor.set(null);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.entryError.set(
          (error as { status?: number }).status === 409
            ? 'Det finns redan en saldonotering för det datumet.'
            : 'Saldonoteringen kunde inte sparas. Försök igen senare.',
        );
      },
    });
  }

  protected deleteEntry(account: ManualSavingsAccount, entry: BalanceEntry): void {
    this.run(
      this.store.deleteEntry(account.id, entry.id),
      () => {
        this.deleting.set(null);
      },
      'Saldonoteringen kunde inte tas bort. Försök igen senare.',
      () => this.deleting.set(null),
    );
  }

  private request() {
    return { name: this.name().trim(), institution: this.institution().trim() || null };
  }

  private run<T>(
    call: Observable<T>,
    done: (result: T) => void,
    message: string,
    failedToo?: () => void,
  ): void {
    this.busy.set(true);
    this.actionFailed.set(null);
    call.subscribe({
      next: (result) => {
        this.busy.set(false);
        done(result);
      },
      error: () => {
        this.busy.set(false);
        this.actionFailed.set(message);
        failedToo?.();
      },
    });
  }
}
