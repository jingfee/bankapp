import { Component, computed, input, output } from '@angular/core';
import type { Category } from '@bankapp/shared';
import { formatAmountInput, parseAmount } from '../../formatting/amount';
import { DateField } from '../../date-field/date-field';
import { Sheet } from '../../sheet/sheet';
import { CategoryIconComponent } from '../../category-icon/category-icon';
import { MANUAL_LABEL } from '../../share-display';
import {
  AMOUNT_PRESETS,
  type Period,
  type TransactionFilters,
  samePeriod,
  amountBound,
} from './transaction-filters';

export interface PanelAccount {
  id: number;
  label: string;
}

/** The sections of the filter panel; every change is reported at once and the page applies it. */
@Component({
  selector: 'app-filter-panel',
  imports: [CategoryIconComponent, DateField, Sheet],
  template: `
    <app-sheet data-filter-panel heading="Filter" size="panel" (closed)="closed.emit()">
      <section data-section="datum" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-muted">Datum</h3>
        <div class="flex flex-wrap gap-2">
          @for (chip of periodChips(); track chip.key) {
            <button
              type="button"
              class="chip"
              [attr.data-period]="chip.key"
              [attr.aria-pressed]="chip.on"
              (click)="choosePeriod(chip.key)"
            >
              {{ chip.label }}
            </button>
          }
        </div>
        @if (custom()) {
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1 text-xs text-muted">
              Från
              <app-date-field
                data-from
                [value]="filters().from"
                (valueChange)="setDate('from', $event)"
              />
            </label>
            <label class="flex flex-col gap-1 text-xs text-muted">
              Till
              <app-date-field
                data-to
                [value]="filters().to"
                (valueChange)="setDate('to', $event)"
              />
            </label>
          </div>
        }
      </section>

      <section data-section="typ" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-muted">Typ</h3>
        <div class="segmented self-start" role="group" aria-label="Typ">
          @for (option of kinds; track option.kind) {
            <button
              type="button"
              [attr.data-kind]="option.kind || 'all'"
              [attr.aria-pressed]="filters().kind === option.kind"
              (click)="change({ kind: option.kind })"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </section>

      <section data-section="belopp" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-muted">Belopp</h3>
        <div class="flex flex-wrap gap-2">
          @for (preset of amountPresets; track preset.label) {
            <button
              type="button"
              class="chip"
              data-amount-preset
              [attr.aria-pressed]="filters().min === preset.min && filters().max === preset.max"
              (click)="toggleAmountPreset(preset)"
            >
              {{ preset.label }}
            </button>
          }
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="field">
            <input
              class="field-control"
              data-min
              inputmode="decimal"
              placeholder="Från"
              aria-label="Lägsta belopp"
              [value]="amountText('min')"
              (change)="setAmount('min', $any($event.target))"
            />
            <span class="field-suffix">kr</span>
          </label>
          <label class="field">
            <input
              class="field-control"
              data-max
              inputmode="decimal"
              placeholder="Till"
              aria-label="Högsta belopp"
              [value]="amountText('max')"
              (change)="setAmount('max', $any($event.target))"
            />
            <span class="field-suffix">kr</span>
          </label>
        </div>
      </section>

      <section data-section="konton" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-muted">Konton</h3>
        <div class="flex flex-col gap-2">
          @for (account of accountOptions(); track account.key) {
            <label class="check-card">
              <input
                type="checkbox"
                class="accent-(--color-accent)"
                [attr.data-account]="account.key"
                [checked]="filters().accounts.includes(account.key)"
                (change)="toggle('accounts', account.key)"
              />
              <span>{{ account.label }}</span>
            </label>
          }
        </div>
      </section>

      <section data-section="kategorier" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-muted">Kategorier</h3>
        <div class="flex flex-wrap gap-2">
          @for (category of categories(); track category.id) {
            <button
              type="button"
              class="chip"
              [attr.data-category]="category.id"
              [attr.aria-pressed]="filters().categories.includes(String(category.id))"
              (click)="toggle('categories', String(category.id))"
            >
              <app-category-icon [icon]="category.icon" [colour]="category.colour" [size]="28" />
              {{ category.name }}
            </button>
          }
          <button
            type="button"
            class="chip"
            data-category="none"
            [attr.aria-pressed]="filters().categories.includes('none')"
            (click)="toggle('categories', 'none')"
          >
            Okategoriserad
          </button>
        </div>
      </section>
      <ng-container sheet-footer>
        <button type="button" data-clear class="btn btn-secondary" (click)="cleared.emit()">
          Rensa
        </button>
        <button type="button" data-show class="btn btn-primary flex-1" (click)="closed.emit()">
          Visa {{ count() ?? '' }} {{ count() === 1 ? 'transaktion' : 'transaktioner' }}
        </button>
      </ng-container>
    </app-sheet>
  `,
})
export class FilterPanel {
  readonly filters = input.required<TransactionFilters>();
  readonly accounts = input.required<PanelAccount[]>();
  readonly categories = input.required<Category[]>();
  /** How many transactions the filters match now, or null while that is not known. */
  readonly count = input<number | null>(null);
  /** The quick periods, so the panel and the page agree on what each one is. */
  readonly presets = input.required<{ last7: Period; month: Period }>();
  readonly monthLabel = input.required<string>();
  /** The owner picked Välj datum, so the date inputs show even before a date is set. */
  readonly custom = input(false);

  readonly changed = output<Partial<TransactionFilters>>();
  readonly customChosen = output<boolean>();
  readonly cleared = output<void>();
  readonly closed = output<void>();

  protected readonly String = String;
  protected readonly amountPresets = AMOUNT_PRESETS;
  protected readonly kinds = [
    { kind: '' as const, label: 'Alla' },
    { kind: 'out' as const, label: 'Utgifter' },
    { kind: 'in' as const, label: 'Inkomster' },
  ];

  protected readonly periodChips = computed(() => {
    const filters = this.filters();
    const presets = this.presets();
    const all = filters.from === '' && filters.to === '';
    const last7 = samePeriod(presets.last7, filters);
    const month = samePeriod(presets.month, filters);
    const custom = this.custom() || (!all && !last7 && !month);
    return [
      { key: 'all', label: 'Alla datum', on: all && !custom },
      { key: 'last7', label: 'Senaste 7 dagarna', on: last7 && !custom },
      { key: 'month', label: this.monthLabel(), on: month && !custom },
      { key: 'custom', label: 'Välj datum', on: custom },
    ];
  });

  protected readonly accountOptions = computed(() => [
    ...this.accounts().map((a) => ({ key: String(a.id), label: a.label })),
    { key: 'manual', label: MANUAL_LABEL },
  ]);

  protected change(change: Partial<TransactionFilters>): void {
    this.changed.emit(change);
  }

  protected choosePeriod(key: string): void {
    this.customChosen.emit(key === 'custom');
    if (key === 'all') this.change({ from: '', to: '' });
    else if (key === 'last7') this.change(this.presets().last7);
    else if (key === 'month') this.change(this.presets().month);
  }

  protected setDate(field: 'from' | 'to', value: string): void {
    this.change({ [field]: value });
  }

  /** The applied bound as the owner reads it: decimal comma. */
  protected amountText(field: 'min' | 'max'): string {
    const parsed = parseAmount(this.filters()[field]);
    return parsed === null ? '' : formatAmountInput(parsed);
  }

  protected toggleAmountPreset(preset: { min: string; max: string }): void {
    const on = this.filters().min === preset.min && this.filters().max === preset.max;
    this.change(on ? { min: '', max: '' } : { min: preset.min, max: preset.max });
  }

  protected setAmount(field: 'min' | 'max', input: HTMLInputElement): void {
    const text = input.value.trim();
    const bound = amountBound(text);
    const valid = bound !== null;
    // A value that is not an amount is dropped, and the field shows what is applied.
    const next = valid ? bound : text === '' ? '' : this.filters()[field];
    this.change({ [field]: next });
    // The field shows the applied value in Swedish form, whatever spelling was typed.
    const applied = parseAmount(next);
    input.value = applied === null ? '' : formatAmountInput(applied);
  }

  protected toggle(field: 'accounts' | 'categories', key: string): void {
    const current = this.filters()[field];
    this.change({
      [field]: current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    });
  }
}
