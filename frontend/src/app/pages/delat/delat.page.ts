import { ShortDatePipe, shortDate } from '../../formatting/short-date.pipe';
import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  type Category,
  type CategoryColour,
  type CategoryIcon,
  type HouseholdRatioEntry,
  type SettlementPeriod,
  type SettlementResponse,
  type ShareOption,
  type Subcategory,
} from '@bankapp/shared';
import { type Observable, catchError, forkJoin, map, of } from 'rxjs';
import { type CategorisedSubcategory, CategoriesService } from '../../categories.service';
import { Callout } from '../../callout/callout';
import { Confirm } from '../../confirm/confirm';
import { Menu, MenuItem } from '../../menu/menu';
import { Sheet } from '../../sheet/sheet';
import { Icon } from '../../icon/icon';
import { Disclosure } from '../../disclosure/disclosure';
import { Skeleton } from '../../skeleton/skeleton';
import { CategoryIconComponent } from '../../category-icon/category-icon';
import { CategoryTiles } from '../../category-tiles/category-tiles';
import { DateField } from '../../date-field/date-field';
import { MonthField } from '../../month-field/month-field';
import { parseAmount } from '../../formatting/amount';
import { MoneyPipe } from '../../formatting/money.pipe';
import { SettlementStore } from '../../stores/settlement.store';
import { SharesStore } from '../../stores/shares.store';
import { owesText } from '../../balance-display';
import { isMonth, today, shiftMonth } from '../../dates';
import { APP_LOCALE } from '../../formatting/locale';
import { ShareControl } from '../../share-control/share-control';
import { SHARE_LABELS } from '../../share-display';
import { ToastService } from '../../toast/toast.service';
import { Page } from '../../page/page';

interface Loaded {
  categories: Category[];
}

type State = Loaded | { failed: true };

const NO_SETTLEMENT: SettlementResponse = { balance: null, periods: [], balanceSettings: [] };

/** A shared subcategory as a row of the list. */
interface SharedRow {
  subcategory: Subcategory;
  category: Category;
  share: ShareOption;
}

/**
 * Everything shared with the partner on one page: the settlement balance and its periods, the
 * household ratio and the subcategories shared by default (ADRs 0008 and 0011).
 */
@Component({
  selector: 'app-delat-page',
  imports: [
    ShortDatePipe,
    Page,
    NgTemplateOutlet,
    RouterLink,
    MoneyPipe,
    CategoryIconComponent,
    CategoryTiles,
    DateField,
    MonthField,
    ShareControl,
    Callout,
    Disclosure,
    Icon,
    Skeleton,
    Confirm,
    Menu,
    MenuItem,
    Sheet,
  ],
  template: `
    <app-page
      [fetchedAt]="fetchedAt()"
      title="Delat"
      subtitle="Avräkning, hushållsandel och delade underkategorier."
    >
      @if (error(); as message) {
        <app-callout variant="danger">{{ message }}</app-callout>
      }

      @let result = loaded();
      @if (!result) {
        <div aria-busy="true" class="grid gap-4 lg:grid-cols-2">
          <div class="flex flex-col gap-4">
            <app-skeleton shape="card" />
            <app-skeleton shape="card" />
          </div>
          <app-skeleton shape="card" />
        </div>
      } @else if ('failed' in result) {
        <app-callout variant="danger"
          >Det delade kunde inte hämtas. Försök igen senare.</app-callout
        >
      } @else {
        <div class="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
          <div class="flex min-w-0 flex-col gap-4">
            <section data-balance-card class="card glow-violet flex flex-col gap-4 p-5 sm:p-6">
              <h2 class="eyebrow">Avräkningssaldo</h2>
              @if (settlementFailed()) {
                <app-callout variant="danger"
                  >Avräkningen kunde inte hämtas. Försök igen senare.</app-callout
                >
              } @else if (settlementLoading()) {
                <app-skeleton shape="card" />
              } @else if (settlement().balance === null) {
                <div data-switch-help>
                  <h3 class="card-title">Ställ in saldot för att börja</h3>
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

              @if (!settlementFailed() && !settlementLoading()) {
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-open-setting
                    class="btn btn-secondary btn-sm"
                    (click)="settingOpen.set(true)"
                  >
                    Ställ in saldo
                  </button>
                  @if (open(); as period) {
                    <button
                      type="button"
                      data-close-month
                      class="btn btn-secondary btn-sm"
                      (click)="startClosing(period)"
                    >
                      Avsluta {{ monthOnly(period.month).toLowerCase() }}
                    </button>
                  }
                </div>
              }
              @if (settingOpen()) {
                <app-sheet
                  data-setting-form
                  heading="Ställ in saldo"
                  [dismissible]="!saving()"
                  (closed)="cancelSetting()"
                  (submitted)="saveBalance()"
                >
                  <label class="flex flex-col gap-1 text-sm text-muted">
                    Saldo
                    <span class="field">
                      <input
                        type="text"
                        inputmode="decimal"
                        data-amount
                        data-autofocus
                        class="field-control"
                        [value]="amount()"
                        (input)="amount.set(value($event))"
                      />
                      <span class="field-suffix">kr</span>
                    </span>
                  </label>
                  <label class="flex flex-col gap-1 text-sm text-muted">
                    Per
                    <app-date-field data-as-of [value]="asOf()" (valueChange)="asOf.set($event)" />
                  </label>
                  @if (error(); as message) {
                    <app-callout variant="danger">{{ message }}</app-callout>
                  }
                  <ng-container sheet-footer>
                    <button
                      type="button"
                      data-cancel-setting
                      class="btn btn-ghost"
                      (click)="cancelSetting()"
                    >
                      Avbryt
                    </button>
                    <button
                      type="submit"
                      data-save-balance
                      class="btn btn-primary flex-1"
                      [disabled]="saving() || !amountValid() || asOf() === ''"
                    >
                      Spara saldo
                    </button>
                  </ng-container>
                </app-sheet>
              }

              @if (open(); as period) {
                @if (closing()) {
                  <app-sheet
                    data-close-form
                    [heading]="'Avsluta ' + monthOnly(period.month).toLowerCase()"
                    [dismissible]="!saving()"
                    (closed)="closing.set(false)"
                    (submitted)="closeMonth()"
                  >
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Avslutsdatum
                      <app-date-field
                        data-closing-date
                        [value]="closingDate()"
                        (valueChange)="closingDate.set($event)"
                      />
                    </label>
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Nästa månad
                      <app-month-field
                        data-next-month
                        [value]="nextMonth()"
                        (valueChange)="nextMonth.set($event)"
                      />
                    </label>
                    @if (error(); as message) {
                      <app-callout variant="danger">{{ message }}</app-callout>
                    }
                    <ng-container sheet-footer>
                      <button type="button" class="btn btn-ghost" (click)="closing.set(false)">
                        Avbryt
                      </button>
                      <button
                        type="submit"
                        data-confirm-close
                        class="btn btn-primary flex-1"
                        [disabled]="saving() || closingDate() === '' || !nextMonthValid(period)"
                      >
                        Avsluta
                      </button>
                    </ng-container>
                  </app-sheet>
                }
              }
            </section>

            @if (open(); as period) {
              <section data-open-period class="card flex flex-col gap-3 p-4 sm:p-5">
                <div class="flex items-center justify-between gap-3">
                  <h2 class="card-title">
                    <span data-period-title>{{ monthName(period.month) }}</span>
                    <span class="text-sm font-normal text-muted"> · pågående</span>
                  </h2>
                  <app-menu label="Åtgärder för perioden">
                    <button
                      appMenuItem
                      type="button"
                      data-edit-month
                      (click)="startEditMonth(period)"
                    >
                      Ändra månad
                    </button>
                  </app-menu>
                </div>
                @if (editingMonth()) {
                  <app-sheet
                    data-month-form
                    heading="Ändra månad"
                    [dismissible]="!saving()"
                    (closed)="editingMonth.set(false)"
                    (submitted)="saveMonth()"
                  >
                    <label class="flex flex-col gap-1 text-sm text-muted">
                      Månad
                      <app-month-field
                        data-month-input
                        [value]="monthDraft()"
                        (valueChange)="monthDraft.set($event)"
                      />
                    </label>
                    @if (error(); as message) {
                      <app-callout variant="danger">{{ message }}</app-callout>
                    }
                    <ng-container sheet-footer>
                      <button type="button" class="btn btn-ghost" (click)="editingMonth.set(false)">
                        Avbryt
                      </button>
                      <button
                        type="submit"
                        data-save-month
                        class="btn btn-primary flex-1"
                        [disabled]="saving() || !monthDraftValid()"
                      >
                        Spara
                      </button>
                    </ng-container>
                  </app-sheet>
                }
                @if (period.overdue) {
                  <p data-overdue class="text-sm text-danger">
                    {{ monthOnly(period.month) }} är inte avslutad
                  </p>
                }
                <div class="flex justify-between text-sm">
                  <span class="text-muted">Ingående saldo</span>
                  <span data-carried-in class="amount">{{ period.carriedIn | money }}</span>
                </div>
                <ng-container
                  [ngTemplateOutlet]="itemList"
                  [ngTemplateOutletContext]="{ $implicit: period.items }"
                />
                @if (period.payments.length > 0) {
                  <ul class="flex flex-col gap-1 border-t border-line pt-3 text-sm">
                    @for (payment of period.payments; track payment.transactionId) {
                      <li data-payment class="flex justify-between">
                        <span class="text-muted">Betalt {{ payment.date | shortDate }}</span>
                        <span class="amount">{{ payment.amount | money }}</span>
                      </li>
                    }
                  </ul>
                }
                <div class="flex justify-between border-t border-line pt-3 text-sm font-medium">
                  <span>Utgående saldo</span>
                  <span data-carried-out class="amount">{{ period.carriedOut | money }}</span>
                </div>
              </section>
            }

            @if (closed().length > 0) {
              <app-disclosure
                class="card block p-2 sm:p-3"
                data-toggle-closed
                label="Tidigare perioder"
                [count]="closed().length"
                [(open)]="showClosed"
              >
                <div class="flex flex-col gap-4">
                  @for (period of closed(); track period.month; let first = $first) {
                    <section
                      data-closed-period
                      [attr.data-month]="period.month"
                      class="card expand-in flex flex-col gap-3 bg-surface-2 p-4 sm:p-5"
                    >
                      <h2 class="card-title">
                        <span data-period-title>{{ monthName(period.month) }}</span>
                        <span class="text-sm font-normal text-muted">
                          · avslutad, t.o.m. {{ period.closedThrough | shortDate }}
                        </span>
                      </h2>
                      <dl class="grid grid-cols-2 gap-y-1 text-sm">
                        <dt class="text-muted">Ingående saldo</dt>
                        <dd data-carried-in class="text-right amount">
                          {{ period.carriedIn | money }}
                        </dd>
                        <dt class="text-muted">Partnerns del</dt>
                        <dd data-period-part class="text-right amount">
                          {{ partnerPartSum(period) | money }}
                        </dd>
                        @for (payment of period.payments; track payment.transactionId) {
                          <dt class="text-muted">Betalt {{ payment.date | shortDate }}</dt>
                          <dd data-payment class="text-right amount">
                            {{ payment.amount | money }}
                          </dd>
                        }
                        <dt class="font-medium">Utgående saldo</dt>
                        <dd data-carried-out class="text-right font-medium amount">
                          {{ period.carriedOut | money }}
                        </dd>
                      </dl>
                      @if (period.items.length > 0) {
                        <app-disclosure
                          data-toggle-items
                          label="Transaktioner"
                          [count]="period.items.length"
                          [open]="itemsShown(period)"
                          (openChange)="toggleItems(period)"
                        >
                          <ng-container
                            [ngTemplateOutlet]="itemList"
                            [ngTemplateOutletContext]="{ $implicit: period.items }"
                          />
                        </app-disclosure>
                      }
                      @if (period.reportSaved === false) {
                        <app-callout data-report-failed variant="danger"
                          >Rapporten kunde inte sparas</app-callout
                        >
                      }
                      <div class="flex">
                        <app-menu label="Åtgärder för perioden">
                          <button
                            appMenuItem
                            type="button"
                            data-save-report
                            [disabled]="saving()"
                            (click)="saveReport(period)"
                          >
                            Spara rapport igen
                          </button>
                          @if (first) {
                            <button
                              appMenuItem
                              type="button"
                              data-undo-close
                              [danger]="true"
                              [disabled]="saving()"
                              (click)="undoing.set(period.month)"
                            >
                              Ångra avslut…
                            </button>
                          }
                        </app-menu>
                      </div>
                    </section>
                  }
                </div>
              </app-disclosure>
            }
          </div>

          <div class="flex min-w-0 flex-col gap-4">
            <section data-ratio-card class="card flex flex-col gap-4 p-5 sm:p-6">
              <h2 class="eyebrow">Hushållsandel</h2>
              @if (sharesFailed()) {
                <app-callout variant="danger"
                  >Hushållsandelen kunde inte hämtas. Försök igen senare.</app-callout
                >
              } @else if (sharesLoading()) {
                <app-skeleton shape="card" />
              } @else {
                @if (current()) {
                  <p data-ratio-heading class="amount text-4xl">
                    {{ sliderValue() }}/{{ 100 - sliderValue() }}
                  </p>
                } @else {
                  <p data-ratio-heading class="card-title">Ingen hushållsandel inställd</p>
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
                      <span class="text-sm">
                        <span class="font-medium"
                          >{{ entry.percent }}/{{ 100 - entry.percent }}</span
                        >
                        <span class="text-muted"> · från {{ entry.from | shortDate }}</span>
                      </span>
                      <app-menu
                        label="Åtgärder för hushållsandelen från {{ entry.from | shortDate }}"
                      >
                        <button
                          appMenuItem
                          type="button"
                          data-edit
                          [disabled]="saving()"
                          (click)="startEdit(entry)"
                        >
                          Ändra
                        </button>
                        <button
                          appMenuItem
                          type="button"
                          data-remove
                          [danger]="true"
                          [disabled]="saving() || ratio().length === 1"
                          (click)="removing.set(entry)"
                        >
                          Ta bort…
                        </button>
                      </app-menu>
                    </li>
                  }
                </ul>
              }
            </section>

            <section data-shared-card class="card flex flex-col gap-4 p-4 sm:p-5">
              <div class="flex items-center justify-between gap-3">
                <h2 class="card-title min-w-0">Delade underkategorier</h2>
                <button
                  type="button"
                  data-add-shared
                  class="btn btn-secondary btn-sm ml-auto whitespace-nowrap"
                  [attr.aria-expanded]="picking()"
                  (click)="picking.set(!picking())"
                >
                  <app-icon name="plus" [size]="16" />
                  Lägg till
                </button>
              </div>
              @if (sharesFailed()) {
                <app-callout variant="danger"
                  >De delade underkategorierna kunde inte hämtas. Försök igen senare.</app-callout
                >
              } @else if (sharesLoading()) {
                <app-skeleton shape="card" />
              } @else {
                <p class="text-sm text-muted">
                  Alla andra underkategorier räknas som Jag (100 %). Ett kontos eller en
                  transaktions egen andel går före.
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
                      <app-share-control
                        class="order-last w-full sm:order-none sm:w-auto"
                        [label]="'Andel för ' + row.subcategory.name"
                        [value]="row.share"
                        [disabled]="saving()"
                        [householdDisabled]="ratio().length === 0"
                        (changed)="setShare(row.subcategory, $event)"
                      />
                    </li>
                  }
                </ul>
              }
            </section>
          </div>
        </div>
      }
      <ng-template #itemList let-items>
        <ul class="flex flex-col divide-y divide-line">
          @for (item of items; track item.transactionId) {
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
                    {{ item.date | shortDate }} · {{ item.amount | money }} ·
                    {{ shareName(item.share) }}
                  </span>
                </span>
                <span
                  data-partner-part
                  class="text-sm amount"
                  [class.text-danger]="item.partnerPart < 0"
                >
                  {{ item.partnerPart | money }}
                </span>
              </a>
            </li>
          }
        </ul>
      </ng-template>
    </app-page>

    @let editEntry = editingEntry();
    @if (editEntry) {
      <app-sheet
        data-ratio-form
        heading="Ändra hushållsandel"
        [dismissible]="!saving()"
        (closed)="editing.set(null)"
        (submitted)="saveEdit(editEntry)"
      >
        <label class="flex flex-col gap-1 text-sm text-muted">
          Från datum
          <app-date-field
            data-edit-from
            label="Från datum"
            [value]="editFrom()"
            (valueChange)="editFrom.set($event)"
          />
        </label>
        <label class="flex flex-col gap-1 text-sm text-muted">
          Din andel i procent
          <input
            type="number"
            data-edit-percent
            data-autofocus
            min="1"
            max="99"
            class="input w-24"
            [value]="editPercent()"
            (input)="editPercent.set(value($event))"
          />
        </label>
        @if (error(); as message) {
          <app-callout variant="danger">{{ message }}</app-callout>
        }
        <ng-container sheet-footer>
          <button type="button" class="btn btn-ghost" (click)="editing.set(null)">Avbryt</button>
          <button type="submit" data-save-edit class="btn btn-primary flex-1" [disabled]="saving()">
            Spara
          </button>
        </ng-container>
      </app-sheet>
    }

    @if (removing(); as entry) {
      <app-confirm
        heading="Ta bort hushållsandelen?"
        [message]="
          'Andelen ' +
          entry.percent +
          '/' +
          (100 - entry.percent) +
          ' från ' +
          entry.from +
          ' tas bort.'
        "
        confirmLabel="Ta bort"
        [busy]="saving()"
        (confirmed)="remove(entry)"
        (cancelled)="removing.set(null)"
      />
    }

    @if (undoing(); as month) {
      <app-confirm
        [heading]="'Ångra avslutet av ' + monthName(month) + '?'"
        message="Perioden blir pågående igen och den nya perioden tas bort."
        confirmLabel="Ångra avslut"
        [busy]="saving()"
        (confirmed)="undoClose()"
        (cancelled)="undoing.set(null)"
      />
    }
  `,
})
export class DelatPage {
  private readonly categoriesService = inject(CategoriesService);
  private readonly settlementStore = inject(SettlementStore);
  private readonly sharesStore = inject(SharesStore);
  /** When the device fetched what the page shows; the page says so while offline. */
  protected readonly fetchedAt = computed(() => [
    this.settlementStore.fetchedAt(),
    this.sharesStore.fetchedAt(),
  ]);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);

  protected readonly fallbackIcon: CategoryIcon = 'arrow-left-right';
  protected readonly fallbackColour: CategoryColour = 'gray';
  protected todayText(): string {
    return today();
  }

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The settlement as the store reads it; empty until it arrives, so the page can lean on it. */
  protected readonly settlement = computed<SettlementResponse>(
    () => this.settlementStore.settlement() ?? NO_SETTLEMENT,
  );
  protected readonly settlementFailed = this.settlementStore.failed;
  protected readonly settlementLoading = this.settlementStore.loading;
  protected readonly sharesFailed = this.sharesStore.failed;
  protected readonly sharesLoading = this.sharesStore.loading;
  protected readonly settingOpen = signal(false);
  protected readonly amount = signal('');
  protected readonly amountValid = computed(() => parseAmount(this.amount()) !== null);
  protected readonly asOf = signal(today());
  protected readonly showClosed = signal(
    // ?manad=yyyy-MM opens the page at that month's period, which may be a closed one.
    this.route.snapshot.queryParamMap.get('manad') !== null,
  );
  /** The closed periods (by month) whose transactions are listed. */
  private readonly itemsOpen = signal<ReadonlySet<string>>(new Set());
  protected readonly editingMonth = signal(false);
  protected readonly monthDraft = signal('');
  protected readonly closing = signal(false);
  protected readonly closingDate = signal('');
  protected readonly nextMonth = signal('');

  protected readonly ratio = computed(() =>
    [...(this.sharesStore.householdRatio() ?? [])].sort((a, b) => a.from.localeCompare(b.from)),
  );
  protected readonly slider = signal<number | null>(null);
  protected readonly editing = signal<string | null>(null);
  /** The ratio entry being removed, awaiting confirmation. */
  protected readonly removing = signal<HouseholdRatioEntry | null>(null);
  /** The month whose closing is being undone, awaiting confirmation. */
  protected readonly undoing = signal<string | null>(null);
  protected readonly editFrom = signal('');
  protected readonly editPercent = signal('');

  /** The share of each subcategory that is not Jag. */
  private readonly subcategoryShares = computed(
    () =>
      new Map<number, ShareOption>(
        (this.sharesStore.subcategoryShares() ?? []).map((s) => [s.subcategoryId, s.share]),
      ),
  );
  private readonly categories = signal<Category[]>([]);
  private readonly allSubcategories = signal<CategorisedSubcategory[]>([]);
  protected readonly picking = signal(false);

  protected readonly loaded = toSignal<State>(
    forkJoin({
      categories: this.categoriesService.list(),
      subcategories: this.categoriesService.subcategories(),
    }).pipe(
      map(({ categories, subcategories }): State => {
        this.categories.set(categories);
        this.allSubcategories.set(subcategories);
        return { categories };
      }),
      catchError(() => of<State>({ failed: true })),
    ),
    { initialValue: undefined },
  );

  constructor() {
    this.settlementStore.activate();
    this.sharesStore.activate();
    inject(DestroyRef).onDestroy(() => {
      this.settlementStore.deactivate();
      this.sharesStore.deactivate();
    });
  }

  protected readonly balanceAmount = computed(() => Math.abs(this.settlement().balance ?? 0));
  protected readonly balanceDirection = computed(() => owesText(this.settlement().balance ?? 0));
  /** The latest settlement's or balance setting's date, as " · sedan avräkningen <date>". */
  protected readonly sinceText = computed(() => {
    const { periods, balanceSettings } = this.settlement();
    const dates = [
      balanceSettings[0]?.asOf ?? '',
      ...periods.flatMap((p) => p.payments.map((payment) => payment.date)),
    ];
    const date = dates.sort().at(-1);
    return date ? ` · sedan avräkningen ${shortDate(date)}` : '';
  });
  protected readonly open = computed(() =>
    this.settlement().periods.find((p) => p.closedThrough === null),
  );
  protected readonly closed = computed(() =>
    this.settlement().periods.filter((p) => p.closedThrough !== null),
  );
  protected readonly monthDraftValid = computed(() => isMonth(this.monthDraft()));

  /** The ratio in force today, as the backend marks it. */
  protected readonly current = computed(() => {
    const from = this.sharesStore.householdRatioInForceFrom();
    return this.ratio().find((entry) => entry.from === from);
  });
  /** The ratio entry open in the edit sheet. */
  protected readonly editingEntry = computed(
    () => this.ratio().find((e) => e.from === this.editing()) ?? null,
  );

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
    return this.allSubcategories().flatMap(({ category, subcategory }) => {
      const share = shares.get(subcategory.id);
      return share === undefined || share === 'me' ? [] : [{ subcategory, category, share }];
    });
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
    return SHARE_LABELS[option];
  }

  /** `2026-10` as "Oktober 2026". */
  protected monthName(month: string): string {
    const [year, number] = month.split('-').map(Number) as [number, number];
    const text = new Intl.DateTimeFormat(APP_LOCALE, { month: 'long', year: 'numeric' }).format(
      new Date(year, number - 1, 1),
    );
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** `2026-10` as "Oktober". */
  protected monthOnly(month: string): string {
    return this.monthName(month).split(' ')[0]!;
  }

  protected itemsShown(period: SettlementPeriod): boolean {
    return this.itemsOpen().has(period.month);
  }

  protected toggleItems(period: SettlementPeriod): void {
    const next = new Set(this.itemsOpen());
    if (!next.delete(period.month)) next.add(period.month);
    this.itemsOpen.set(next);
  }

  protected startEditMonth(period: SettlementPeriod): void {
    this.monthDraft.set(period.month);
    this.editingMonth.set(true);
  }

  protected saveMonth(): void {
    this.run(
      this.settlementStore.setOpenMonth({ month: this.monthDraft() }),
      'Månaden kunde inte ändras. Den måste vara senare än den förra.',
      () => this.editingMonth.set(false),
    );
  }

  /** Opens the close form: the day the partner last paid in the period, else today. */
  protected startClosing(period: SettlementPeriod): void {
    this.closingDate.set(period.payments.at(-1)?.date ?? today());
    this.nextMonth.set(shiftMonth(period.month, 1));
    this.closing.set(true);
  }

  protected nextMonthValid(period: SettlementPeriod): boolean {
    return isMonth(this.nextMonth()) && this.nextMonth() > period.month;
  }

  protected closeMonth(): void {
    this.run(
      this.settlementStore.close({
        closedThrough: this.closingDate(),
        nextMonth: this.nextMonth(),
      }),
      'Månaden kunde inte avslutas. Kontrollera datum och nästa månad.',
      () => this.closing.set(false),
    );
  }

  protected saveReport(period: SettlementPeriod): void {
    this.run(this.settlementStore.saveReport(period.month), 'Rapporten kunde inte sparas.');
  }

  protected undoClose(): void {
    this.run(this.settlementStore.undoClose(), 'Avslutet kunde inte ångras.', () =>
      this.undoing.set(null),
    );
  }

  /** Sends a change to the periods and shows the answer, or `failure`. */
  private run(request: Observable<SettlementResponse>, failure: string, done?: () => void): void {
    this.saving.set(true);
    this.error.set(null);
    request.subscribe({
      next: () => {
        done?.();
        this.saving.set(false);
      },
      error: () => {
        this.error.set(failure);
        // A confirmation gives way to the error on the page.
        this.undoing.set(null);
        this.saving.set(false);
      },
    });
  }

  protected partnerPartSum(period: { items: { partnerPart: number }[] }): number {
    return Math.round(period.items.reduce((sum, item) => sum + item.partnerPart, 0) * 100) / 100;
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected cancelSetting(): void {
    this.settingOpen.set(false);
    this.amount.set('');
    this.asOf.set(today());
    this.error.set(null);
  }

  protected saveBalance(): void {
    const amount = parseAmount(this.amount());
    if (amount === null) {
      this.error.set('Ange saldot som ett tal.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.settlementStore.setBalance({ amount, asOf: this.asOf() }).subscribe({
      next: () => {
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
    this.saveRatio(
      this.ratio().filter((e) => e.from !== entry.from),
      () => this.removing.set(null),
    );
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
    this.sharesStore
      .setHouseholdRatio([...entries].sort((a, b) => a.from.localeCompare(b.from)))
      .subscribe({
        next: () => {
          this.saving.set(false);
          done?.();
        },
        error: () => {
          this.saving.set(false);
          this.removing.set(null);
          this.error.set('Hushållsandelen kunde inte sparas. Försök igen senare.');
        },
      });
  }

  /** A subcategory picked in the picker is shared 50/50 to begin with. */
  protected add(subcategoryId: number): void {
    this.saveShare(subcategoryId, 'half', () => this.picking.set(false));
  }

  /** Choosing Jag removes the row: Jag is what every unlisted subcategory already is. */
  protected setShare(subcategory: Subcategory, option: ShareOption): void {
    if ((this.subcategoryShares().get(subcategory.id) ?? 'me') === option) return;
    this.saveShare(
      subcategory.id,
      option,
      option === 'me'
        ? () => this.toast.show(`${subcategory.name} räknas som Jag igen`)
        : undefined,
    );
  }

  private saveShare(id: number, option: ShareOption, done?: () => void): void {
    this.saving.set(true);
    this.error.set(null);
    this.sharesStore.setSubcategoryShare(id, option).subscribe({
      next: () => {
        this.saving.set(false);
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
