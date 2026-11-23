import { Component, inject, output, signal } from '@angular/core';
import type { BalanceEntry, ManualSavingsAccount } from '@bankapp/shared';
import { type Observable, catchError, map, of } from 'rxjs';
import { today } from '../dates';
import { Callout } from '../callout/callout';
import { Empty } from '../empty/empty';
import { Icon } from '../icon/icon';
import { DateField } from '../date-field/date-field';
import { formatAmountInput, parseAmount } from '../formatting/amount';
import { MoneyPipe } from '../formatting/money.pipe';
import { ManualSavingsService } from '../manual-savings.service';

/** Manuella sparkonton: savings accounts the app cannot reach, such as an ISK, kept up to date by hand. */
@Component({
  selector: 'app-manual-savings-section',
  imports: [DateField, MoneyPipe, Callout, Empty, Icon],
  template: `
    <section data-manual-savings class="card flex flex-col gap-4 p-4 sm:p-5">
      <div class="flex items-center justify-between gap-3">
        <h2 class="card-title">Manuella sparkonton</h2>
        @if (!adding()) {
          <button
            type="button"
            data-open-add-account
            class="btn btn-sm btn-secondary"
            (click)="openAdd()"
          >
            <app-icon name="plus" [size]="16" />
            Lägg till sparkonto
          </button>
        }
      </div>

      @if (failed(); as message) {
        <app-callout variant="danger">{{ message }}</app-callout>
      }

      @if (adding()) {
        <form
          data-account-form
          class="flex flex-wrap items-end gap-3"
          (submit)="$event.preventDefault(); createAccount()"
        >
          <label class="flex flex-col gap-1 text-sm text-muted">
            Namn
            <span class="field"
              ><input
                data-account-name-input
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
          <button
            type="submit"
            data-save-account
            class="btn btn-primary"
            [disabled]="busy() || name().trim() === ''"
          >
            Spara
          </button>
          <button type="button" class="btn btn-ghost" (click)="closeAdd()">Avbryt</button>
        </form>
      }

      @let list = accounts();
      @if (list.length === 0 && !adding()) {
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
              @if (renamingId() === account.id) {
                <form
                  data-rename-form
                  class="flex flex-wrap items-end gap-2"
                  (submit)="$event.preventDefault(); rename(account)"
                >
                  <span class="field"
                    ><input
                      data-rename-input
                      class="field-control"
                      aria-label="Namn"
                      [value]="name()"
                      (input)="name.set(value($event))"
                  /></span>
                  <span class="field"
                    ><input
                      class="field-control"
                      aria-label="Bank eller förvaltare"
                      [value]="institution()"
                      (input)="institution.set(value($event))"
                  /></span>
                  <button
                    type="submit"
                    data-save-rename
                    class="btn btn-sm btn-primary"
                    [disabled]="busy() || name().trim() === ''"
                  >
                    Spara
                  </button>
                  <button type="button" class="btn btn-sm btn-ghost" (click)="renamingId.set(null)">
                    Avbryt
                  </button>
                </form>
              } @else {
                <span class="flex min-w-0 flex-col">
                  <span data-manual-name class="truncate font-medium">{{ account.name }}</span>
                  <span class="text-sm text-muted">
                    {{ account.institution ?? 'Sparkonto' }}
                    @if (account.closedOn) {
                      · <span data-closed>Avslutat {{ account.closedOn }}</span>
                    } @else if (account.balance === null) {
                      · <span>Ingen saldonotering ännu</span>
                    }
                  </span>
                </span>
                <span class="flex flex-none flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    data-rename
                    class="btn btn-sm btn-secondary"
                    (click)="startRename(account)"
                  >
                    Byt namn
                  </button>
                  @if (account.closedOn) {
                    <button
                      type="button"
                      data-reopen
                      class="btn btn-sm btn-secondary"
                      [disabled]="busy()"
                      (click)="reopen(account)"
                    >
                      Öppna igen
                    </button>
                  } @else {
                    <button
                      type="button"
                      data-close
                      class="btn btn-sm btn-secondary"
                      (click)="closingId.set(account.id); closeDate.set(today())"
                    >
                      Avsluta
                    </button>
                  }
                </span>
              }
            </div>

            @if (closingId() === account.id) {
              <form
                data-close-form
                class="flex flex-wrap items-end gap-3"
                (submit)="$event.preventDefault(); close(account)"
              >
                <label class="flex flex-col gap-1 text-sm text-muted">
                  Avslutat den
                  <app-date-field [value]="closeDate()" (valueChange)="closeDate.set($event)" />
                </label>
                <button
                  type="submit"
                  data-confirm-close
                  class="btn btn-primary"
                  [disabled]="busy() || closeDate() === ''"
                >
                  Avsluta konto
                </button>
                <button type="button" class="btn btn-ghost" (click)="closingId.set(null)">
                  Avbryt
                </button>
              </form>
            }

            @if (!account.closedOn) {
              @if (entryFormFor() === account.id) {
                <form
                  data-entry-form
                  class="flex flex-col gap-3"
                  (submit)="$event.preventDefault(); saveEntry(account)"
                >
                  <div class="flex flex-wrap items-end gap-3">
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
                  </div>
                  @if (entryError(); as message) {
                    <app-callout data-entry-error variant="danger">{{ message }}</app-callout>
                  }
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      data-save-entry
                      class="btn btn-primary"
                      [disabled]="busy()"
                    >
                      Spara
                    </button>
                    <button
                      type="button"
                      data-cancel-entry
                      class="btn btn-ghost"
                      (click)="entryFormFor.set(null)"
                    >
                      Avbryt
                    </button>
                  </div>
                </form>
              } @else {
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
            }

            @if (account.entries.length > 0) {
              <ul class="flex flex-col divide-y divide-line text-sm" data-entries>
                @for (entry of account.entries; track entry.id) {
                  <li class="flex items-center justify-between gap-3 py-2" data-entry>
                    <span class="flex flex-wrap gap-x-3">
                      <span data-entry-day>{{ entry.date }}</span>
                      <span class="amount">{{ entry.balance | money }}</span>
                      <span class="text-muted">
                        {{ entry.netDeposits === null ? 'Insatt –' : 'Insatt ' }}
                        @if (entry.netDeposits !== null) {
                          <span class="amount">{{ entry.netDeposits | money }}</span>
                        }
                      </span>
                    </span>
                    <span class="flex flex-none gap-2">
                      <button
                        type="button"
                        data-edit-entry
                        class="btn btn-sm btn-ghost"
                        (click)="startEntry(account, entry)"
                      >
                        Ändra
                      </button>
                      <button
                        type="button"
                        data-delete-entry
                        class="btn btn-sm btn-danger-soft"
                        [disabled]="busy()"
                        (click)="deleteEntry(account, entry)"
                      >
                        Ta bort
                      </button>
                    </span>
                  </li>
                }
              </ul>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class ManualSavingsSection {
  private readonly service = inject(ManualSavingsService);
  /** Emits after the owner has changed an account or an entry, so figures built on them can refresh. */
  readonly changed = output<void>();
  protected readonly today = today;

  /** The accounts as last returned; every change replaces the account it touched. */
  protected readonly accounts = signal<ManualSavingsAccount[]>([]);
  protected readonly failed = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly adding = signal(false);
  protected readonly name = signal('');
  protected readonly institution = signal('');
  protected readonly renamingId = signal<number | null>(null);
  protected readonly closingId = signal<number | null>(null);
  protected readonly closeDate = signal(today());

  protected readonly entryFormFor = signal<number | null>(null);
  /** The entry being corrected, or null when a new one is being made. */
  private editing: BalanceEntry | null = null;
  protected readonly entryDate = signal(today());
  protected readonly entryBalance = signal('');
  protected readonly entryDeposits = signal('');
  protected readonly entryError = signal<string | null>(null);

  constructor() {
    this.service
      .list()
      .pipe(
        map((response) => response.accounts),
        catchError(() => {
          this.failed.set('Sparkontona kunde inte hämtas. Försök igen senare.');
          return of<ManualSavingsAccount[]>([]);
        }),
      )
      .subscribe((accounts) => this.accounts.set(accounts));
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected createAccount(): void {
    this.run(
      this.service.create(this.request()),
      (created) => {
        this.accounts.update((all) => [...all, created]);
        this.changed.emit();
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
    this.adding.set(true);
  }

  protected closeAdd(): void {
    this.name.set('');
    this.institution.set('');
    this.adding.set(false);
  }

  protected startRename(account: ManualSavingsAccount): void {
    this.name.set(account.name);
    this.institution.set(account.institution ?? '');
    this.adding.set(false);
    this.renamingId.set(account.id);
  }

  protected rename(account: ManualSavingsAccount): void {
    this.run(
      this.service.rename(account.id, this.request()),
      (updated) => {
        this.replace(updated);
        this.renamingId.set(null);
      },
      'Namnet kunde inte sparas. Försök igen senare.',
    );
  }

  protected close(account: ManualSavingsAccount): void {
    this.run(
      this.service.close(account.id, { date: this.closeDate() }),
      (updated) => {
        this.replace(updated);
        this.closingId.set(null);
        if (this.entryFormFor() === account.id) this.entryFormFor.set(null);
      },
      'Kontot kunde inte avslutas. Försök igen senare.',
    );
  }

  protected reopen(account: ManualSavingsAccount): void {
    this.run(
      this.service.reopen(account.id),
      (updated) => this.replace(updated),
      'Kontot kunde inte öppnas igen. Försök igen senare.',
    );
  }

  /** Opens the entry form for a new entry, or for correcting `entry`. */
  protected startEntry(account: ManualSavingsAccount, entry: BalanceEntry | null = null): void {
    this.editing = entry;
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
    const editing = this.editing;
    this.busy.set(true);
    (editing
      ? this.service.updateEntry(account.id, editing.id, request)
      : this.service.addEntry(account.id, request)
    ).subscribe({
      next: (updated) => {
        this.busy.set(false);
        this.replace(updated);
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
    if (!confirm(`Ta bort saldonoteringen ${entry.date}?`)) return;
    this.run(
      this.service.deleteEntry(account.id, entry.id),
      (updated) => this.replace(updated),
      'Saldonoteringen kunde inte tas bort. Försök igen senare.',
    );
  }

  private request() {
    return { name: this.name().trim(), institution: this.institution().trim() || null };
  }

  private replace(updated: ManualSavingsAccount): void {
    this.accounts.update((all) => all.map((one) => (one.id === updated.id ? updated : one)));
    this.changed.emit();
  }

  private run<T>(call: Observable<T>, done: (result: T) => void, message: string): void {
    this.busy.set(true);
    this.failed.set(null);
    call.subscribe({
      next: (result) => {
        this.busy.set(false);
        done(result);
      },
      error: () => {
        this.busy.set(false);
        this.failed.set(message);
      },
    });
  }
}
