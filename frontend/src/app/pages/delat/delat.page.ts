import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  type Category,
  type CategoryColour,
  type CategoryIcon,
  type HouseholdRatioEntry,
  type SettlementResponse,
  type ShareOption,
  type Subcategory,
} from '@bankapp/shared';
import { catchError, forkJoin, map, of } from 'rxjs';
import { CategoriesService } from '../../categories.service';
import { CategoryIconComponent } from '../../category-icon/category-icon';
import { CategoryTiles } from '../../category-tiles/category-tiles';
import { MoneyPipe } from '../../formatting/money.pipe';
import { SettlementService } from '../../settlement.service';
import { SharesService } from '../../shares.service';
import { ToastService } from '../../toast/toast.service';

interface Loaded {
  categories: Category[];
}

type State = Loaded | { failed: true };

/** A shared subcategory as a row of the list. */
interface SharedRow {
  subcategory: Subcategory;
  category: Category;
  share: ShareOption;
}

/** The shares a subcategory can be set to from here; Jag is the × button. */
const SHARE_CHOICES: readonly { option: ShareOption; label: string }[] = [
  { option: 'half', label: '50/50' },
  { option: 'household', label: 'Hushåll' },
  { option: 'partner', label: 'Partner' },
];

const SHARE_ORDER: Record<ShareOption, string> = {
  me: 'Jag',
  half: '50/50',
  household: 'Hushåll',
  partner: 'Partner',
};

/** Today as `YYYY-MM-DD` in the owner's own time zone. */
function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

/**
 * Everything shared with the partner on one page: the settlement balance and its periods, the
 * household ratio and the subcategories shared by default (ADRs 0008 and 0011).
 */
@Component({
  selector: 'app-delat-page',
  imports: [RouterLink, MoneyPipe, CategoryIconComponent, CategoryTiles],
  template: `
    <main class="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:py-10">
      <header>
        <h1 class="font-display text-3xl font-semibold tracking-tight">Delat</h1>
        <p class="mt-1 text-muted">Avräkning, hushållsandel och delade underkategorier.</p>
      </header>

      @if (error(); as message) {
        <p role="alert" class="text-sm text-danger">{{ message }}</p>
      }

      @let result = loaded();
      @if (!result) {
        <p aria-live="polite">Hämtar delat…</p>
      } @else if ('failed' in result) {
        <p role="alert">Det delade kunde inte hämtas. Försök igen senare.</p>
      } @else {
        <div class="grid items-start gap-4 lg:grid-cols-2">
          <div class="flex flex-col gap-4">
            <section data-balance-card class="card glow-violet flex flex-col gap-4 p-6">
              <h2 class="text-sm font-medium text-muted">Avräkningssaldo</h2>
              @if (settlement().balance === null) {
                <div data-switch-help>
                  <h3 class="text-lg font-semibold">Ställ in saldot för att börja</h3>
                  <p class="mt-2 text-sm text-muted">
                    Ställ in saldot till partnerns andel av det som redan är betalt, per idag. Har
                    partnerns senaste överföring också täckt räkningar som betalas de närmaste
                    dagarna är saldot negativt tills de bokförs. Kommande fakturor räknas inte.
                  </p>
                </div>
              } @else {
                <div>
                  <p data-balance class="amount text-4xl">{{ balanceAmount() | money }}</p>
                  <p data-balance-direction class="mt-1 text-sm text-muted">
                    {{ balanceDirection() }}{{ sinceText() }}
                  </p>
                </div>
              }

              @if (settingOpen()) {
                <form
                  data-setting-form
                  class="expand-in flex flex-wrap items-end gap-3"
                  (submit)="$event.preventDefault(); saveBalance()"
                >
                  <label class="flex flex-col gap-1 text-sm text-muted">
                    Saldo
                    <span class="field">
                      <input
                        type="text"
                        inputmode="decimal"
                        data-amount
                        class="field-control"
                        [value]="amount()"
                        (input)="amount.set(value($event))"
                      />
                      <span class="field-suffix">kr</span>
                    </span>
                  </label>
                  <label class="flex flex-col gap-1 text-sm text-muted">
                    Per
                    <input
                      type="date"
                      data-as-of
                      class="input"
                      [value]="asOf()"
                      (input)="asOf.set(value($event))"
                    />
                  </label>
                  <button
                    type="submit"
                    data-save-balance
                    class="btn btn-primary"
                    [disabled]="saving() || amount().trim() === '' || asOf() === ''"
                  >
                    Spara saldo
                  </button>
                </form>
              } @else {
                <div>
                  <button
                    type="button"
                    data-open-setting
                    class="btn btn-secondary btn-sm"
                    (click)="settingOpen.set(true)"
                  >
                    Ställ in saldo
                  </button>
                </div>
              }
            </section>

            @if (open(); as period) {
              <section data-open-period class="card flex flex-col gap-3 p-5">
                <h2 class="font-display text-lg font-semibold">Pågående period</h2>
                <div class="flex justify-between text-sm">
                  <span class="text-muted">Ingående saldo</span>
                  <span data-carried-in class="tabular-nums">{{ period.carriedIn | money }}</span>
                </div>
                <ul class="flex flex-col divide-y divide-line">
                  @for (item of period.items; track item.transactionId) {
                    <li data-item>
                      <a
                        [routerLink]="['/transaktioner', item.transactionId]"
                        class="flex items-center gap-3 py-2.5"
                      >
                        <app-category-icon
                          [icon]="item.icon ?? fallbackIcon"
                          [colour]="item.colour ?? fallbackColour"
                          [size]="28"
                        />
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm">{{ item.description }}</span>
                          <span class="text-xs text-muted">
                            {{ item.date }} · {{ item.amount | money }} ·
                            {{ shareName(item.share) }}
                          </span>
                        </span>
                        <span
                          data-partner-part
                          class="text-sm tabular-nums"
                          [class.text-danger]="item.partnerPart < 0"
                        >
                          {{ item.partnerPart | money }}
                        </span>
                      </a>
                    </li>
                  }
                </ul>
                <div class="flex justify-between border-t border-line pt-3 text-sm font-medium">
                  <span>Utgående saldo</span>
                  <span data-carried-out class="tabular-nums">{{ period.carriedOut | money }}</span>
                </div>
              </section>
            }

            @if (closed().length > 0) {
              <div>
                <button
                  type="button"
                  data-toggle-closed
                  class="btn btn-ghost btn-sm"
                  [attr.aria-expanded]="showClosed()"
                  (click)="showClosed.set(!showClosed())"
                >
                  {{ showClosed() ? 'Dölj tidigare perioder' : 'Visa tidigare perioder' }}
                </button>
              </div>
              @if (showClosed()) {
                @for (period of closed(); track $index) {
                  <section data-closed-period class="card expand-in flex flex-col gap-3 p-5">
                    <h2 data-period-title class="font-display text-lg font-semibold">
                      Avräknad {{ period.closedOn }}
                    </h2>
                    <dl class="grid grid-cols-2 gap-y-1 text-sm">
                      <dt class="text-muted">Ingående saldo</dt>
                      <dd data-carried-in class="text-right tabular-nums">
                        {{ period.carriedIn | money }}
                      </dd>
                      <dt class="text-muted">Partnerns del</dt>
                      <dd data-period-part class="text-right tabular-nums">
                        {{ partnerPartSum(period) | money }}
                      </dd>
                      <dt class="text-muted">Betalt</dt>
                      <dd data-paid class="text-right tabular-nums">{{ period.paid | money }}</dd>
                      <dt class="font-medium">Utgående saldo</dt>
                      <dd data-carried-out class="text-right font-medium tabular-nums">
                        {{ period.carriedOut | money }}
                      </dd>
                    </dl>
                  </section>
                }
              }
            }
          </div>

          <div class="flex flex-col gap-4">
            <section data-ratio-card class="card flex flex-col gap-4 p-6">
              <h2 class="text-sm font-medium text-muted">Hushållsandel</h2>
              @if (current()) {
                <p data-ratio-heading class="amount text-4xl">
                  {{ sliderValue() }}/{{ 100 - sliderValue() }}
                </p>
              } @else {
                <p data-ratio-heading class="text-lg font-semibold">Ingen hushållsandel inställd</p>
              }
              <input
                type="range"
                data-slider
                class="slider"
                min="1"
                max="99"
                aria-label="Din andel i procent"
                [value]="sliderValue()"
                [style.--fill.%]="sliderValue()"
                (input)="slider.set(+value($event))"
              />
              @if (sliderChanged()) {
                <div class="expand-in flex flex-wrap items-center justify-between gap-3">
                  <p data-slider-note class="text-sm text-muted">
                    Gäller från {{ todayText() }}. Tidigare månader ändras inte.
                  </p>
                  <button
                    type="button"
                    data-save-slider
                    class="btn btn-primary btn-sm"
                    [disabled]="saving()"
                    (click)="saveSlider()"
                  >
                    Spara
                  </button>
                </div>
              }

              <ul class="divide-y divide-line">
                @for (entry of history(); track entry.from) {
                  <li
                    data-ratio-entry
                    class="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    @if (editing() === entry.from) {
                      <span class="flex flex-wrap items-center gap-2">
                        <input
                          type="date"
                          data-edit-from
                          aria-label="Från datum"
                          class="input"
                          [value]="editFrom()"
                          (input)="editFrom.set(value($event))"
                        />
                        <input
                          type="number"
                          data-edit-percent
                          aria-label="Din andel i procent"
                          min="1"
                          max="99"
                          class="input w-24"
                          [value]="editPercent()"
                          (input)="editPercent.set(value($event))"
                        />
                      </span>
                      <span class="flex gap-2">
                        <button
                          type="button"
                          data-save-edit
                          class="btn btn-primary btn-sm"
                          [disabled]="saving()"
                          (click)="saveEdit(entry)"
                        >
                          Spara
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-sm"
                          (click)="editing.set(null)"
                        >
                          Avbryt
                        </button>
                      </span>
                    } @else {
                      <span class="text-sm">
                        <span class="font-medium"
                          >{{ entry.percent }}/{{ 100 - entry.percent }}</span
                        >
                        <span class="text-muted"> · från {{ entry.from }}</span>
                      </span>
                      <span class="flex gap-2">
                        <button
                          type="button"
                          data-edit
                          class="btn btn-ghost btn-sm"
                          [disabled]="saving()"
                          (click)="startEdit(entry)"
                        >
                          Ändra
                        </button>
                        <button
                          type="button"
                          data-remove
                          class="btn btn-ghost btn-sm"
                          [disabled]="saving() || ratio().length === 1"
                          (click)="remove(entry)"
                        >
                          Ta bort
                        </button>
                      </span>
                    }
                  </li>
                }
              </ul>
            </section>

            <section data-shared-card class="card flex flex-col gap-4 p-6">
              <div class="flex items-center justify-between gap-3">
                <h2 class="whitespace-nowrap text-sm font-medium text-muted">
                  Delade underkategorier
                </h2>
                <button
                  type="button"
                  data-add-shared
                  class="btn btn-secondary btn-sm ml-auto whitespace-nowrap"
                  [attr.aria-expanded]="picking()"
                  (click)="picking.set(!picking())"
                >
                  + Lägg till
                </button>
              </div>
              <p class="text-sm text-muted">
                Alla andra underkategorier räknas som Jag (100 %). Ett kontos eller en transaktions
                egen andel går före.
              </p>

              @if (picking()) {
                <app-category-tiles [categories]="pickable()" (picked)="add($event)" />
              }

              <ul class="flex flex-col divide-y divide-line">
                @for (row of sharedRows(); track row.subcategory.id) {
                  <li data-shared class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                    <app-category-icon
                      [icon]="row.subcategory.icon"
                      [colour]="row.category.colour"
                      [size]="28"
                    />
                    <span class="min-w-0 flex-1 basis-40">
                      <span data-name class="block truncate text-sm font-medium">{{
                        row.subcategory.name
                      }}</span>
                      <span class="text-xs text-muted">{{ row.category.name }}</span>
                    </span>
                    <span
                      class="segmented order-last w-full sm:order-none sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none"
                      role="group"
                      [attr.aria-label]="'Andel för ' + row.subcategory.name"
                    >
                      @for (choice of choices; track choice.option) {
                        <button
                          type="button"
                          [attr.data-share]="choice.option"
                          [attr.aria-pressed]="row.share === choice.option"
                          [disabled]="saving()"
                          (click)="setShare(row.subcategory, choice.option)"
                        >
                          {{ choice.label }}
                        </button>
                      }
                    </span>
                    <button
                      type="button"
                      data-remove-shared
                      class="btn btn-ghost btn-sm"
                      [attr.aria-label]="'Sätt ' + row.subcategory.name + ' till Jag'"
                      [disabled]="saving()"
                      (click)="removeShare(row.subcategory)"
                    >
                      ×
                    </button>
                  </li>
                }
              </ul>
            </section>
          </div>
        </div>
      }
    </main>
  `,
})
export class DelatPage {
  private readonly categoriesService = inject(CategoriesService);
  private readonly shares = inject(SharesService);
  private readonly settlementService = inject(SettlementService);
  private readonly toast = inject(ToastService);

  protected readonly choices = SHARE_CHOICES;
  protected readonly fallbackIcon: CategoryIcon = 'arrow-left-right';
  protected readonly fallbackColour: CategoryColour = 'gray';
  protected todayText(): string {
    return today();
  }

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly settlement = signal<SettlementResponse>({
    balance: null,
    periods: [],
    balanceSettings: [],
  });
  protected readonly settingOpen = signal(false);
  protected readonly amount = signal('');
  protected readonly asOf = signal(today());
  protected readonly showClosed = signal(false);

  protected readonly ratio = signal<HouseholdRatioEntry[]>([]);
  protected readonly slider = signal<number | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly editFrom = signal('');
  protected readonly editPercent = signal('');

  /** The share of each subcategory that is not Jag. */
  private readonly subcategoryShares = signal(new Map<number, ShareOption>());
  private readonly categories = signal<Category[]>([]);
  protected readonly picking = signal(false);

  protected readonly loaded = toSignal<State>(
    forkJoin({
      categories: this.categoriesService.list(),
      shares: this.shares.subcategoryShares(),
      ratio: this.shares.householdRatio(),
      settlement: this.settlementService.get(),
    }).pipe(
      map(({ categories, shares, ratio, settlement }): State => {
        this.subcategoryShares.set(new Map(shares.map((s) => [s.subcategoryId, s.share])));
        this.ratio.set([...ratio].sort((a, b) => a.from.localeCompare(b.from)));
        this.settlement.set(settlement);
        this.categories.set(categories);
        return { categories };
      }),
      catchError(() => of<State>({ failed: true })),
    ),
    { initialValue: undefined },
  );

  protected readonly balanceAmount = computed(() => Math.abs(this.settlement().balance ?? 0));
  protected readonly balanceDirection = computed(() =>
    (this.settlement().balance ?? 0) < 0 ? 'Du är skyldig partnern' : 'Partnern är skyldig dig',
  );
  /** The latest balance setting's date, as " · sedan avräkningen <date>". */
  protected readonly sinceText = computed(() => {
    const { periods, balanceSettings } = this.settlement();
    const settled = periods.find((p) => p.closedOn !== null)?.closedOn ?? '';
    const date = [settled, balanceSettings[0]?.asOf ?? ''].sort().at(-1);
    return date ? ` · sedan avräkningen ${date}` : '';
  });
  protected readonly open = computed(() =>
    this.settlement().periods.find((p) => p.closedOn === null),
  );
  protected readonly closed = computed(() =>
    this.settlement().periods.filter((p) => p.closedOn !== null),
  );

  /** The ratio in force today: the latest entry from today or before, else the first. */
  protected readonly current = computed(() => {
    const entries = this.ratio();
    const now = today();
    return entries.filter((e) => e.from <= now).at(-1) ?? entries[0];
  });
  /** The history with the entry in force first, then the rest newest first. */
  protected readonly history = computed(() => {
    const current = this.current();
    const rest = [...this.ratio()].sort((a, b) => b.from.localeCompare(a.from));
    return current ? [current, ...rest.filter((e) => e !== current)] : rest;
  });
  protected readonly sliderValue = computed(() => this.slider() ?? this.current()?.percent ?? 50);
  protected readonly sliderChanged = computed(() => {
    const value = this.slider();
    return value !== null && value !== this.current()?.percent;
  });

  protected readonly sharedRows = computed<SharedRow[]>(() => {
    const shares = this.subcategoryShares();
    return this.categories().flatMap((category) =>
      category.subcategories.flatMap((subcategory) => {
        const share = shares.get(subcategory.id);
        return share === undefined || share === 'me' ? [] : [{ subcategory, category, share }];
      }),
    );
  });
  /** The categories with only the subcategories that are still Jag. */
  protected readonly pickable = computed(() => {
    const shares = this.subcategoryShares();
    return this.categories()
      .map((category) => ({
        ...category,
        subcategories: category.subcategories.filter((s) => (shares.get(s.id) ?? 'me') === 'me'),
      }))
      .filter((category) => category.subcategories.length > 0);
  });

  protected shareName(option: ShareOption): string {
    return SHARE_ORDER[option];
  }

  protected partnerPartSum(period: { items: { partnerPart: number }[] }): number {
    return Math.round(period.items.reduce((sum, item) => sum + item.partnerPart, 0) * 100) / 100;
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected saveBalance(): void {
    const amount = Number(this.amount().replace(',', '.'));
    if (!Number.isFinite(amount)) {
      this.error.set('Ange saldot som ett tal.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.settlementService.setBalance({ amount, asOf: this.asOf() }).subscribe({
      next: (response) => {
        this.settlement.set(response);
        this.amount.set('');
        this.asOf.set(today());
        this.settingOpen.set(false);
        this.saving.set(false);
      },
      error: () => {
        this.error.set('Saldot kunde inte sparas. Försök igen.');
        this.saving.set(false);
      },
    });
  }

  protected saveSlider(): void {
    const percent = this.sliderValue();
    const from = today();
    this.saveRatio([...this.ratio().filter((e) => e.from !== from), { from, percent }], () =>
      this.slider.set(null),
    );
  }

  protected startEdit(entry: HouseholdRatioEntry): void {
    this.editing.set(entry.from);
    this.editFrom.set(entry.from);
    this.editPercent.set(String(entry.percent));
  }

  protected saveEdit(original: HouseholdRatioEntry): void {
    const entry = this.parse(this.editFrom(), this.editPercent());
    if (entry === null) return;
    this.saveRatio(
      [...this.ratio().filter((e) => e.from !== original.from && e.from !== entry.from), entry],
      () => this.editing.set(null),
    );
  }

  protected remove(entry: HouseholdRatioEntry): void {
    if (this.ratio().length === 1) return;
    this.saveRatio(this.ratio().filter((e) => e.from !== entry.from));
  }

  /** A valid entry from the form's text, or null after showing what is wrong. */
  private parse(from: string, percentText: string): HouseholdRatioEntry | null {
    const percent = Number(percentText);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      this.error.set('Välj ett datum.');
      return null;
    }
    if (percentText.trim() === '' || !Number.isInteger(percent) || percent < 1 || percent > 99) {
      this.error.set('Andelen måste vara ett heltal mellan 1 och 99.');
      return null;
    }
    return { from, percent };
  }

  private saveRatio(entries: HouseholdRatioEntry[], done?: () => void): void {
    this.saving.set(true);
    this.error.set(null);
    this.shares
      .setHouseholdRatio([...entries].sort((a, b) => a.from.localeCompare(b.from)))
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.ratio.set(saved);
          this.refreshSettlement();
          done?.();
        },
        error: () => {
          this.saving.set(false);
          this.error.set('Hushållsandelen kunde inte sparas. Försök igen senare.');
        },
      });
  }

  /** The ratio and the shares drive the balance, so it is fetched again after they change. */
  private refreshSettlement(): void {
    this.settlementService.get().subscribe({
      next: (response) => this.settlement.set(response),
    });
  }

  /** A subcategory picked in the picker is shared 50/50 to begin with. */
  protected add(subcategoryId: number): void {
    this.saveShare(subcategoryId, 'half', () => this.picking.set(false));
  }

  protected setShare(subcategory: Subcategory, option: ShareOption): void {
    if (this.subcategoryShares().get(subcategory.id) === option) return;
    this.saveShare(subcategory.id, option);
  }

  protected removeShare(subcategory: Subcategory): void {
    this.saveShare(subcategory.id, 'me', () =>
      this.toast.show(`${subcategory.name} räknas som Jag igen`),
    );
  }

  private saveShare(id: number, option: ShareOption, done?: () => void): void {
    this.saving.set(true);
    this.error.set(null);
    this.shares.setSubcategoryShare(id, option).subscribe({
      next: () => {
        this.saving.set(false);
        this.subcategoryShares.update((shares) => {
          const next = new Map(shares);
          if (option === 'me') next.delete(id);
          else next.set(id, option);
          return next;
        });
        this.refreshSettlement();
        done?.();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.error.set(
          (error as { status?: number }).status === 409
            ? 'Hushåll kan väljas först när en hushållsandel har ställts in.'
            : 'Andelen kunde inte sparas. Försök igen senare.',
        );
      },
    });
  }
}
