import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import type {
  LoanPart,
  MortgageEntry,
  MortgageResponse,
  RecurringDayRequest,
} from '@bankapp/shared';
import { type Observable, concat, last } from 'rxjs';
import { DateField } from '../../date-field/date-field';
import { today } from '../../dates';
import { formatAmountInput, parseAmount } from '../../formatting/amount';
import { MoneyPipe } from '../../formatting/money.pipe';
import { MortgageService } from '../../mortgage.service';

/** The form that is open besides a part's own edit form: at most one at a time. */
type Panel = { kind: 'add-part' } | { kind: 'entry'; entry: MortgageEntry | null };

const INTERVAL = /^\d+$/;

/**
 * Bolån: set up the mortgage and keep its loan parts' terms up to date by hand. A simple page
 * for now; the figures and the overview come with the Bolån page proper.
 */
@Component({
  selector: 'app-bolan-page',
  imports: [DateField, MoneyPipe, NgTemplateOutlet],
  template: `
    <main class="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:gap-5 sm:p-8">
      <h1 class="font-display text-2xl font-bold tracking-tight">Bolån</h1>

      @if (failed(); as message) {
        <p role="alert" class="text-danger">{{ message }}</p>
      }

      <section class="card flex flex-col gap-4 p-5" data-mortgage>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-display text-lg font-semibold">Lånedelar</h2>
          <div class="flex flex-wrap gap-2">
            @if (openParts().length > 0 && panel()?.kind !== 'entry') {
              <button
                type="button"
                data-new-entry
                class="btn btn-sm btn-secondary"
                (click)="startEntry(null)"
              >
                Ny bolånenotering
              </button>
            }
            @if (panel()?.kind !== 'add-part') {
              <button
                type="button"
                data-add-part
                class="btn btn-sm btn-secondary"
                (click)="startAddPart()"
              >
                {{ parts().length === 0 ? 'Ställ in bolånet' : 'Lägg till lånedel' }}
              </button>
            }
          </div>
        </div>

        @if (panel()?.kind === 'add-part') {
          <form
            data-part-form
            class="flex flex-col gap-4"
            (submit)="$event.preventDefault(); addPart()"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
                Namn
                <input
                  data-name
                  class="input"
                  placeholder="Del 1 – 3 mån"
                  [value]="name()"
                  (input)="name.set(value($event))"
                />
              </label>
              <label class="flex flex-col gap-1 text-sm text-muted">
                Startdatum
                <app-date-field [value]="date()" (valueChange)="date.set($event)" />
              </label>
              <label class="flex flex-col gap-1 text-sm text-muted">
                Kvarvarande skuld
                <span class="field">
                  <input
                    data-debt
                    type="text"
                    inputmode="decimal"
                    class="field-control"
                    [value]="debt()"
                    (input)="debt.set(value($event))"
                  />
                  <span class="field-suffix">kr</span>
                </span>
              </label>
              <label class="flex flex-col gap-1 text-sm text-muted">
                Ränta
                <span class="field">
                  <input
                    data-rate
                    type="text"
                    inputmode="decimal"
                    class="field-control"
                    [value]="rate()"
                    (input)="rate.set(value($event))"
                  />
                  <span class="field-suffix">%</span>
                </span>
              </label>
              <label class="flex flex-col gap-1 text-sm text-muted">
                Amortering per månad
                <span class="field">
                  <input
                    data-amortisation
                    type="text"
                    inputmode="decimal"
                    class="field-control"
                    [value]="amount()"
                    (input)="amount.set(value($event))"
                  />
                  <span class="field-suffix">kr</span>
                </span>
              </label>
              <ng-container *ngTemplateOutlet="days" />
            </div>
            <ng-container *ngTemplateOutlet="formActions; context: { save: 'Spara lånedel' }" />
          </form>
        }

        @if (parts().length === 0 && panel()?.kind !== 'add-part') {
          <p class="text-sm text-muted">Inget bolån ännu. Ställ in det med sin första lånedel.</p>
        }

        <ul class="flex flex-col divide-y divide-line">
          @for (part of parts(); track part.id) {
            <li class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" [attr.data-part]="part.id">
              <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-1">
                  <span data-part-name class="truncate font-medium">{{ part.name }}</span>
                  @if (part.endedOn) {
                    <span data-ended class="text-sm text-muted">Avslutad {{ part.endedOn }}</span>
                  } @else {
                    <span class="text-sm text-muted">
                      Skuld
                      <span data-part-debt class="amount">{{
                        part.debt === null ? '–' : (part.debt | money)
                      }}</span>
                      · Ränta
                      <span data-part-rate>{{
                        part.rate === null ? '–' : percent(part.rate)
                      }}</span>
                      · Amortering
                      <span data-part-amortisation class="amount">{{
                        part.amortisation === null ? '–' : (part.amortisation | money)
                      }}</span
                      >/mån
                    </span>
                    <span class="text-sm text-muted">
                      Räntejustering <span data-rate-day>{{ part.rateAdjustment.next }}</span> ·
                      Villkorsändring <span data-terms-day>{{ part.termsChange.next }}</span>
                    </span>
                  }
                </div>
                @if (!part.endedOn && editingId() !== part.id) {
                  <button
                    type="button"
                    data-edit
                    class="btn btn-sm btn-secondary flex-none"
                    (click)="startEdit(part)"
                  >
                    Ändra
                  </button>
                }
              </div>

              @if (editingId() === part.id) {
                <form
                  data-part-panel
                  class="flex flex-col gap-4"
                  (submit)="$event.preventDefault(); saveEdit(part)"
                >
                  <div class="grid gap-3 sm:grid-cols-2">
                    <label class="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
                      Namn
                      <input
                        data-name
                        class="input"
                        [value]="name()"
                        (input)="name.set(value($event))"
                      />
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Ränta
                      <span class="field">
                        <input
                          data-rate
                          type="text"
                          inputmode="decimal"
                          class="field-control"
                          [value]="rate()"
                          (input)="rate.set(value($event)); rateTouched.set(true)"
                        />
                        <span class="field-suffix">%</span>
                      </span>
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Gäller från
                      <app-date-field
                        data-rate-from
                        [value]="rateFrom()"
                        (valueChange)="rateFrom.set($event); rateTouched.set(true)"
                      />
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Amortering per månad
                      <span class="field">
                        <input
                          data-amortisation
                          type="text"
                          inputmode="decimal"
                          class="field-control"
                          [value]="amount()"
                          (input)="amount.set(value($event)); amountTouched.set(true)"
                        />
                        <span class="field-suffix">kr</span>
                      </span>
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Gäller från
                      <app-date-field
                        data-amortisation-from
                        [value]="amountFrom()"
                        (valueChange)="amountFrom.set($event); amountTouched.set(true)"
                      />
                    </label>
                    <ng-container *ngTemplateOutlet="days" />
                  </div>
                  <p class="text-xs text-muted">
                    Ränta och amortering sparas som en ny ändring bara om du rör dem. Samma ränta
                    igen noteras också.
                  </p>
                  @if (ending()) {
                    <div
                      data-end-row
                      class="flex flex-col gap-2 rounded-[10px] border border-line-strong p-3"
                    >
                      <label class="flex flex-col gap-1 text-sm text-muted">
                        Avslutad den
                        <app-date-field [value]="endDate()" (valueChange)="endDate.set($event)" />
                      </label>
                      <div class="flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-confirm-end
                          class="btn btn-sm btn-secondary"
                          [disabled]="busy()"
                          (click)="endPart(part)"
                        >
                          Avsluta lånedelen
                        </button>
                        <button
                          type="button"
                          class="btn btn-sm btn-ghost"
                          (click)="ending.set(false)"
                        >
                          Behåll
                        </button>
                      </div>
                    </div>
                  }
                  <ng-container
                    *ngTemplateOutlet="formActions; context: { save: 'Spara', end: true }"
                  />
                </form>
              }
            </li>
          }
        </ul>
      </section>

      @if (panel()?.kind === 'entry') {
        <section class="card flex flex-col gap-4 p-5">
          <h2 class="font-display text-lg font-semibold">Bolånenotering</h2>
          <form
            data-entry-form
            class="flex flex-col gap-4"
            (submit)="$event.preventDefault(); saveEntry()"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex flex-col gap-1 text-sm text-muted sm:col-span-2">
                Datum
                <app-date-field data-entry-date [value]="date()" (valueChange)="date.set($event)" />
              </label>
              @for (part of entryParts(); track part.id) {
                <label class="flex flex-col gap-1 text-sm text-muted">
                  {{ part.name }}
                  <span class="field">
                    <input
                      type="text"
                      inputmode="decimal"
                      class="field-control"
                      [attr.data-entry-debt]="part.id"
                      [value]="debts()[part.id] ?? ''"
                      (input)="setDebt(part.id, value($event))"
                    />
                    <span class="field-suffix">kr</span>
                  </span>
                </label>
              }
            </div>
            <ng-container *ngTemplateOutlet="formActions; context: { save: 'Spara notering' }" />
          </form>
        </section>
      }

      @if (entries().length > 0) {
        <section class="card flex flex-col gap-3 p-5">
          <h2 class="font-display text-lg font-semibold">Noteringar</h2>
          <ul class="flex flex-col divide-y divide-line text-sm" data-entries>
            @for (entry of entries(); track entry.id) {
              <li class="flex items-start justify-between gap-3 py-2" data-entry>
                <span class="flex min-w-0 flex-wrap gap-x-3">
                  <span data-entry-day>{{ entry.date }}</span>
                  @for (debt of entry.debts; track debt.partId) {
                    <span class="text-muted">
                      {{ partName(debt.partId) }}
                      <span class="amount">{{ debt.debt | money }}</span>
                    </span>
                  }
                </span>
                <span class="flex flex-none gap-1">
                  <button
                    type="button"
                    data-edit-entry
                    class="btn btn-sm btn-ghost"
                    (click)="startEntry(entry)"
                  >
                    Ändra
                  </button>
                  <button
                    type="button"
                    data-delete-entry
                    class="btn btn-sm btn-ghost"
                    [disabled]="busy()"
                    (click)="deleteEntry(entry)"
                  >
                    Ta bort
                  </button>
                </span>
              </li>
            }
          </ul>
        </section>
      }
    </main>

    <ng-template #days>
      <label class="flex flex-col gap-1 text-sm text-muted">
        Nästa räntejusteringsdag
        <app-date-field data-rate-date [value]="rateDate()" (valueChange)="rateDate.set($event)" />
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted">
        Intervall
        <span class="field">
          <input
            data-rate-interval
            type="text"
            inputmode="numeric"
            class="field-control"
            [value]="rateInterval()"
            (input)="rateInterval.set(value($event))"
          />
          <span class="field-suffix">mån</span>
        </span>
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted">
        Nästa villkorsändringsdag
        <app-date-field
          data-terms-date
          [value]="termsDate()"
          (valueChange)="termsDate.set($event)"
        />
      </label>
      <label class="flex flex-col gap-1 text-sm text-muted">
        Intervall
        <span class="field">
          <input
            data-terms-interval
            type="text"
            inputmode="numeric"
            class="field-control"
            [value]="termsInterval()"
            (input)="termsInterval.set(value($event))"
          />
          <span class="field-suffix">mån</span>
        </span>
      </label>
    </ng-template>

    <ng-template #formActions let-save="save" let-end="end">
      @if (formError(); as message) {
        <p data-form-error role="alert" class="text-sm text-danger">{{ message }}</p>
      }
      <div class="flex flex-wrap items-center gap-2">
        <button type="submit" data-save class="btn btn-primary" [disabled]="busy()">
          {{ save }}
        </button>
        <button type="button" data-cancel class="btn btn-ghost" (click)="cancel()">Avbryt</button>
        @if (end && !ending()) {
          <button type="button" data-end class="btn btn-ghost ml-auto" (click)="ending.set(true)">
            Avsluta lånedel…
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class BolanPage {
  private readonly service = inject(MortgageService);

  protected readonly mortgage = signal<MortgageResponse>({ parts: [], entries: [] });
  protected readonly parts = computed(() => this.mortgage().parts);
  protected readonly entries = computed(() => this.mortgage().entries);
  protected readonly openParts = computed(() => this.parts().filter((part) => !part.endedOn));
  protected readonly failed = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly panel = signal<Panel | null>(null);
  protected readonly formError = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly date = signal(today());
  protected readonly editingId = signal<number | null>(null);
  protected readonly ending = signal(false);
  protected readonly endDate = signal(today());
  protected readonly rateFrom = signal(today());
  protected readonly amountFrom = signal(today());
  protected readonly rateTouched = signal(false);
  protected readonly amountTouched = signal(false);
  protected readonly debt = signal('');
  protected readonly rate = signal('');
  protected readonly amount = signal('');
  protected readonly rateDate = signal('');
  protected readonly rateInterval = signal('3');
  protected readonly termsDate = signal('');
  protected readonly termsInterval = signal('12');
  /** The debt typed for each part in the entry form, as text. */
  protected readonly debts = signal<Record<number, string>>({});

  /** The parts an entry on the chosen day asks about: those open on it. */
  protected readonly entryParts = computed(() => {
    const day = this.date();
    return this.parts().filter(
      (part) => part.startedOn <= day && (part.endedOn === null || day < part.endedOn),
    );
  });

  constructor() {
    this.service.get().subscribe({
      next: (mortgage) => this.mortgage.set(mortgage),
      error: () => this.failed.set('Bolånet kunde inte hämtas. Försök igen senare.'),
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected percent(rate: number): string {
    return `${formatAmountInput(rate)} %`;
  }

  protected partName(id: number): string {
    return this.parts().find((part) => part.id === id)?.name ?? '–';
  }

  protected startAddPart(): void {
    this.reset();
    this.date.set(today());
    this.panel.set({ kind: 'add-part' });
  }

  /** Opens the one edit form for a part, filled with what is in force now. */
  protected startEdit(part: LoanPart): void {
    this.reset();
    this.name.set(part.name);
    this.rate.set(part.rate === null ? '' : formatAmountInput(part.rate));
    this.amount.set(part.amortisation === null ? '' : formatAmountInput(part.amortisation));
    this.rateDate.set(part.rateAdjustment.next);
    this.rateInterval.set(String(part.rateAdjustment.intervalMonths));
    this.termsDate.set(part.termsChange.next);
    this.termsInterval.set(String(part.termsChange.intervalMonths));
    this.editingId.set(part.id);
  }

  protected cancel(): void {
    this.panel.set(null);
    this.editingId.set(null);
  }

  /** Opens the entry form for a new entry, prefilled with the current debts, or to correct one. */
  protected startEntry(entry: MortgageEntry | null): void {
    this.reset();
    this.date.set(entry?.date ?? today());
    this.debts.set(
      Object.fromEntries(
        entry
          ? entry.debts.map((debt) => [debt.partId, formatAmountInput(debt.debt)])
          : this.openParts().map((part) => [
              part.id,
              part.debt === null ? '' : formatAmountInput(part.debt),
            ]),
      ),
    );
    this.panel.set({ kind: 'entry', entry });
  }

  protected setDebt(partId: number, text: string): void {
    this.debts.update((all) => ({ ...all, [partId]: text }));
  }

  protected addPart(): void {
    const debt = parseAmount(this.debt());
    const rate = parseAmount(this.rate());
    const amortisation = parseAmount(this.amount());
    if (this.name().trim() === '') return this.formError.set('Ange ett namn.');
    if (this.date() === '' || this.date() > today()) {
      return this.formError.set('Ange ett startdatum som inte ligger i framtiden.');
    }
    if (debt === null || debt < 0) return this.formError.set('Ange skulden som ett belopp.');
    if (rate === null || rate < 0) return this.formError.set('Ange räntan i procent, t.ex. 3,85.');
    if (amortisation === null || amortisation < 0) {
      return this.formError.set('Ange amorteringen som ett belopp, 0 eller mer.');
    }
    const days = this.recurringDays();
    if (days === null) return;
    this.submit(
      this.service.addPart({
        name: this.name().trim(),
        startedOn: this.date(),
        debt,
        rate,
        amortisation,
        rateAdjustment: days.rateAdjustment,
        termsChange: days.termsChange,
      }),
    );
  }

  /**
   * Saves the edit form: name and days always; a new rate or amortisation only if the owner
   * touched it, so re-entering the same rate records that it was checked.
   */
  protected saveEdit(part: LoanPart): void {
    if (this.name().trim() === '') return this.formError.set('Ange ett namn.');
    const days = this.recurringDays();
    if (days === null) return;
    const calls: Observable<MortgageResponse>[] = [
      this.service.updatePart(part.id, { name: this.name().trim(), ...days }),
    ];
    if (this.rateTouched()) {
      const rate = parseAmount(this.rate());
      if (rate === null || rate < 0)
        return this.formError.set('Ange räntan i procent, t.ex. 3,85.');
      if (this.rateFrom() === '')
        return this.formError.set('Ange från vilket datum räntan gäller.');
      calls.push(this.service.addRateChange(part.id, { from: this.rateFrom(), rate }));
    }
    if (this.amountTouched()) {
      const amount = parseAmount(this.amount());
      if (amount === null || amount < 0) {
        return this.formError.set('Ange amorteringen som ett belopp, 0 eller mer.');
      }
      if (this.amountFrom() === '') {
        return this.formError.set('Ange från vilket datum amorteringen gäller.');
      }
      calls.push(this.service.addAmortisationChange(part.id, { from: this.amountFrom(), amount }));
    }
    this.submit(concat(...calls).pipe(last()));
  }

  protected endPart(part: LoanPart): void {
    if (this.endDate() === '' || this.endDate() > today()) {
      return this.formError.set('Ange ett datum som inte ligger i framtiden.');
    }
    this.submit(this.service.endPart(part.id, { date: this.endDate() }));
  }

  protected saveEntry(): void {
    const open = this.panel();
    if (open?.kind !== 'entry') return;
    if (this.date() === '' || this.date() > today()) {
      return this.formError.set('Ange ett datum som inte ligger i framtiden.');
    }
    const debts: { partId: number; debt: number }[] = [];
    for (const part of this.entryParts()) {
      const debt = parseAmount(this.debts()[part.id] ?? '');
      if (debt === null || debt < 0) {
        return this.formError.set(`Ange skulden för ${part.name} som ett belopp.`);
      }
      debts.push({ partId: part.id, debt });
    }
    if (debts.length === 0) return this.formError.set('Ingen lånedel är öppen det datumet.');
    const request = { date: this.date(), debts };
    this.submit(
      open.entry
        ? this.service.updateEntry(open.entry.id, request)
        : this.service.addEntry(request),
    );
  }

  protected deleteEntry(entry: MortgageEntry): void {
    if (!confirm(`Ta bort bolånenoteringen ${entry.date}?`)) return;
    this.busy.set(true);
    this.failed.set(null);
    this.service.deleteEntry(entry.id).subscribe({
      next: (mortgage) => {
        this.busy.set(false);
        this.mortgage.set(mortgage);
      },
      error: () => {
        this.busy.set(false);
        this.failed.set('Noteringen kunde inte tas bort. Försök igen senare.');
      },
    });
  }

  private recurringDays(): {
    rateAdjustment: RecurringDayRequest;
    termsChange: RecurringDayRequest;
  } | null {
    const read = (dateText: string, intervalText: string, label: string) => {
      const interval = INTERVAL.test(intervalText.trim()) ? Number(intervalText.trim()) : 0;
      if (dateText === '' || interval < 1) {
        this.formError.set(`Ange ${label} och ett intervall på minst 1 månad.`);
        return null;
      }
      return { next: dateText, intervalMonths: interval };
    };
    const rateAdjustment = read(this.rateDate(), this.rateInterval(), 'nästa räntejusteringsdag');
    if (rateAdjustment === null) return null;
    const termsChange = read(this.termsDate(), this.termsInterval(), 'nästa villkorsändringsdag');
    if (termsChange === null) return null;
    return { rateAdjustment, termsChange };
  }

  private reset(): void {
    this.formError.set(null);
    this.panel.set(null);
    this.editingId.set(null);
    this.ending.set(false);
    this.endDate.set(today());
    this.rateFrom.set(today());
    this.amountFrom.set(today());
    this.rateTouched.set(false);
    this.amountTouched.set(false);
    this.name.set('');
    this.debt.set('');
    this.rate.set('');
    this.amount.set('');
    this.rateDate.set('');
    this.rateInterval.set('3');
    this.termsDate.set('');
    this.termsInterval.set('12');
  }

  private submit(call: Observable<MortgageResponse>): void {
    this.formError.set(null);
    this.busy.set(true);
    call.subscribe({
      next: (mortgage) => {
        this.busy.set(false);
        this.mortgage.set(mortgage);
        this.panel.set(null);
        this.editingId.set(null);
        this.ending.set(false);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.formError.set(
          (error as { status?: number }).status === 409
            ? 'Det går inte att spara just nu: lånedelen är avslutad, eller så finns redan en notering för det datumet.'
            : 'Det gick inte att spara. Kontrollera uppgifterna och försök igen.',
        );
      },
    });
  }
}
