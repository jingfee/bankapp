import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CATEGORY_PALETTE, type Category, type Money, type Transaction } from '@bankapp/shared';
import {
  type Subscription,
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  switchMap,
} from 'rxjs';
import { AccountsService } from '../../accounts.service';
import { CategoriesService } from '../../categories.service';
import { APP_LOCALE } from '../../formatting/locale';
import { MoneyPipe } from '../../formatting/money.pipe';
import { shortDate } from '../../formatting/short-date.pipe';
import { Callout } from '../../callout/callout';
import { Empty } from '../../empty/empty';
import { Icon } from '../../icon/icon';
import { ManualTransactionSheet } from '../../manual-transaction-sheet/manual-transaction-sheet';
import { ToastService } from '../../toast/toast.service';
import { Page } from '../../page/page';
import { Skeleton } from '../../skeleton/skeleton';
import { MANUAL_LABEL } from '../../share-display';
import { TransactionList } from '../../transaction-list/transaction-list';
import { TransactionsService } from '../../transactions.service';
import { FilterPanel, type PanelAccount } from './filter-panel';
import {
  AMOUNT_PRESETS,
  EMPTY_FILTERS,
  type TransactionFilters,
  activeFilterCount,
  filtersFromParams,
  filtersToParams,
  periodPresets,
  samePeriod,
} from './transaction-filters';

type Status = 'loading' | 'ready' | 'failed';

interface ActiveChip {
  key: string;
  label: string;
  /** The category's colour, shown as a dot. */
  dot?: string;
  remove: Partial<TransactionFilters>;
}

/** The search debounce: the list follows the field once the owner pauses typing. */
const SEARCH_DEBOUNCE_MS = 250;

@Component({
  selector: 'app-transactions-page',
  imports: [
    TransactionList,
    RouterLink,
    FilterPanel,
    MoneyPipe,
    ManualTransactionSheet,
    Page,
    Callout,
    Empty,
    Icon,
    Skeleton,
  ],
  // The routed page is its own stacking context (see `router-outlet + *`), so while the filter
  // panel or the add form is open it must rise above the bottom tabs (z-30),
  // otherwise they would cover the panel's footer.
  host: { class: 'relative', '[class.z-40]': 'panelOpen() || adding()' },
  template: `
    <app-page width="narrow" title="Transaktioner">
      <a
        page-actions
        routerLink="/transaktioner/ny"
        queryParamsHandling="preserve"
        data-add
        class="btn btn-secondary btn-sm flex-none whitespace-nowrap"
        aria-label="Lägg till manuell transaktion"
        ><app-icon name="plus" [size]="16" /><span class="max-[359px]:hidden">Manuell</span></a
      >

      <div class="flex gap-2">
        <label class="field min-w-0 flex-1">
          <app-icon class="field-icon" name="search" [size]="20" />
          <input
            type="search"
            data-search
            class="field-control"
            placeholder="Sök transaktioner"
            aria-label="Sök transaktioner"
            autocomplete="off"
            [value]="searchText()"
            (input)="typeSearch($any($event.target).value)"
          />
          @if (searchText() !== '') {
            <button
              type="button"
              data-clear-search
              aria-label="Rensa sökning"
              class="field-icon"
              (click)="clearSearch()"
            >
              <app-icon name="x" />
            </button>
          }
        </label>
        <button
          type="button"
          data-filter-button
          class="btn btn-secondary relative h-[46px] flex-none"
          aria-label="Filter"
          (click)="openPanel()"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          <span class="hidden sm:inline">Filter</span>
          @if (filterCount() > 0) {
            <span
              data-filter-count
              class="bg-accent text-on-accent rounded-full px-2 text-xs font-semibold"
              >{{ filterCount() }}</span
            >
          }
        </button>
      </div>

      <div class="flex flex-wrap gap-2" role="group" aria-label="Period">
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

      @if (activeChips().length > 0) {
        <div class="flex flex-wrap items-center gap-2" data-active-filters>
          @for (chip of activeChips(); track chip.key) {
            <button
              type="button"
              class="chip on"
              data-active-chip
              [attr.aria-label]="'Ta bort filter ' + chip.label"
              (click)="apply(chip.remove)"
            >
              @if (chip.dot) {
                <span
                  data-dot
                  class="size-2 rounded-full"
                  [style.background]="chip.dot"
                  aria-hidden="true"
                ></span>
              }
              {{ chip.label }} <app-icon name="x" [size]="14" />
            </button>
          }
          <button type="button" data-clear-all class="btn btn-ghost btn-sm" (click)="clearAll()">
            Rensa alla
          </button>
        </div>
      }

      @switch (status()) {
        @case ('loading') {
          <div aria-busy="true"><app-skeleton [count]="8" /></div>
        }
        @case ('failed') {
          <app-callout variant="danger"
            >Transaktionerna kunde inte hämtas. Försök igen senare.</app-callout
          >
        }
        @default {
          @if (transactions().length === 0) {
            @if (filtered()) {
              <app-empty data-no-results icon="search" text="Inga transaktioner matchar.">
                <button
                  empty-action
                  type="button"
                  data-clear-filters
                  class="btn btn-secondary btn-sm"
                  (click)="clearAll()"
                >
                  Rensa filter
                </button>
              </app-empty>
            } @else {
              <app-empty icon="receipt" text="Inga transaktioner ännu.">
                <a empty-action routerLink="/anslut-bank" class="btn btn-secondary btn-sm"
                  >Anslut bank</a
                >
              </app-empty>
            }
          } @else if (filtered()) {
            <p data-result class="text-sm text-muted" aria-live="polite">
              {{ count() }} {{ count() === 1 ? 'transaktion' : 'transaktioner' }}
              @if (sum(); as total) {
                · {{ total.amount | money: total.currency }}
              }
            </p>
          }
          <app-transaction-list [transactions]="transactions()" />
          @if (moreFailed()) {
            <app-callout variant="danger">Fler transaktioner kunde inte hämtas.</app-callout>
          }
          @if (cursor() !== null) {
            <button
              type="button"
              data-more
              class="btn btn-secondary w-full"
              [disabled]="loadingMore()"
              (click)="loadMore()"
            >
              Visa fler
            </button>
          }
        }
      }
    </app-page>

    @if (adding()) {
      <app-manual-transaction-sheet (saved)="onAdded()" (closed)="closeSheet()" />
    }

    @if (panelOpen()) {
      <app-filter-panel
        [filters]="filters()"
        [accounts]="accounts()"
        [categories]="categories()"
        [count]="status() === 'ready' ? count() : null"
        [presets]="presets"
        [monthLabel]="monthLabel"
        [custom]="customDates()"
        (changed)="apply($event)"
        (customChosen)="customDates.set($event)"
        (cleared)="clearAll()"
        (closed)="closePanel()"
      />
    }
  `,
})
export class TransactionsPage {
  private readonly service = inject(TransactionsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly accountsService = inject(AccountsService);
  private readonly categoriesService = inject(CategoriesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  /** `/transaktioner/ny` opens the add form over the list. */
  protected readonly adding = toSignal(
    this.route.url.pipe(map((segments) => segments.length === 2)),
    { initialValue: false },
  );

  protected readonly status = signal<Status>('loading');
  protected readonly cursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);
  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly count = signal(0);
  protected readonly sum = signal<Money | null>(null);

  protected readonly filters = signal<TransactionFilters>(EMPTY_FILTERS);
  protected readonly searchText = signal('');
  protected readonly panelOpen = signal(false);
  /** The owner picked Välj datum, so the date inputs show before a date is chosen. */
  protected readonly customDates = signal(false);
  protected readonly accounts = signal<PanelAccount[]>([]);
  protected readonly categories = signal<Category[]>([]);
  private lookupsLoaded = false;

  private readonly today = new Date();
  protected readonly presets = periodPresets(this.today);
  protected readonly monthLabel = new Intl.DateTimeFormat(APP_LOCALE, { month: 'long' })
    .format(this.today)
    .replace(/^./, (c) => c.toUpperCase());

  protected readonly filterCount = computed(() => activeFilterCount(this.filters()));
  protected readonly filtered = computed(() => this.filterCount() > 0 || this.filters().q !== '');

  protected readonly periodChips = computed(() => {
    const filters = this.filters();
    const all = filters.from === '' && filters.to === '';
    const last7 = samePeriod(this.presets.last7, filters);
    const month = samePeriod(this.presets.month, filters);
    const custom = this.customDates() || (!all && !last7 && !month);
    return [
      { key: 'all', label: 'Alla datum', on: all && !custom },
      { key: 'last7', label: 'Senaste 7 dagarna', on: last7 && !custom },
      { key: 'month', label: this.monthLabel, on: month && !custom },
      { key: 'custom', label: 'Välj datum', on: custom },
    ];
  });

  protected readonly activeChips = computed<ActiveChip[]>(() => {
    const f = this.filters();
    const chips: ActiveChip[] = [];
    if (f.from !== '' || f.to !== '') {
      chips.push({
        key: 'period',
        label: this.periodLabel(f),
        remove: { from: '', to: '' },
      });
    }
    if (f.kind !== '') {
      chips.push({
        key: 'kind',
        label: f.kind === 'out' ? 'Utgifter' : 'Inkomster',
        remove: { kind: '' },
      });
    }
    if (f.min !== '' || f.max !== '') {
      chips.push({ key: 'amount', label: this.amountLabel(f), remove: { min: '', max: '' } });
    }
    for (const key of f.accounts) {
      const label =
        key === 'manual'
          ? MANUAL_LABEL
          : (this.accounts().find((a) => String(a.id) === key)?.label ?? 'Konto');
      chips.push({
        key: `account-${key}`,
        label,
        remove: { accounts: f.accounts.filter((k) => k !== key) },
      });
    }
    for (const key of f.categories) {
      const category = this.categories().find((c) => String(c.id) === key);
      chips.push({
        key: `category-${key}`,
        label: key === 'none' ? 'Okategoriserad' : (category?.name ?? 'Kategori'),
        ...(category ? { dot: CATEGORY_PALETTE[category.colour].colour } : {}),
        remove: { categories: f.categories.filter((k) => k !== key) },
      });
    }
    for (const key of f.subcategories) {
      const name = this.categories()
        .flatMap((c) => c.subcategories)
        .find((s) => String(s.id) === key)?.name;
      chips.push({
        key: `subcategory-${key}`,
        label: name ?? 'Underkategori',
        remove: { subcategories: f.subcategories.filter((k) => k !== key) },
      });
    }
    return chips;
  });

  private readonly typed = new Subject<string>();
  /** The filters the URL is heading for, so a change made before it has loaded builds on the last one. */
  private target = EMPTY_FILTERS;
  private moreRequest: Subscription | undefined;

  constructor() {
    this.typed
      .pipe(debounceTime(SEARCH_DEBOUNCE_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => this.apply({ q }, true));

    this.route.queryParamMap
      .pipe(
        map(filtersFromParams),
        distinctUntilChanged((a, b) => queryOf(a) === queryOf(b)),
        switchMap((filters) => {
          this.filters.set(filters);
          this.target = filters;
          // A next page of the previous filters must not be added to this list.
          this.moreRequest?.unsubscribe();
          this.loadingMore.set(false);
          if (filters.q !== this.searchText().trim()) this.searchText.set(filters.q);
          if (
            filters.accounts.length > 0 ||
            filters.categories.length > 0 ||
            filters.subcategories.length > 0
          )
            this.loadLookups();
          return this.load(filters);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  /** Loads the first page, or shows the list as it was left when coming back to it. */
  private load(filters: TransactionFilters) {
    const key = queryOf(filters);
    // Coming back with the browser's back button, show the list as it was left so the router
    // can restore the scroll position; any other visit loads it afresh.
    const left = this.service.listed;
    if (
      left !== null &&
      left.key === key &&
      this.router.currentNavigation()?.trigger === 'popstate'
    ) {
      this.transactions.set(left.transactions);
      this.cursor.set(left.cursor);
      this.count.set(left.count);
      this.sum.set(left.sum);
      this.status.set('ready');
      return of(null);
    }
    if (this.transactions().length === 0) this.status.set('loading');
    this.moreFailed.set(false);
    return this.service.list(undefined, filters).pipe(
      map((page) => {
        this.transactions.set(page.transactions);
        this.cursor.set(page.nextCursor);
        this.count.set(page.count);
        this.sum.set(page.sum);
        this.remember();
        this.status.set('ready');
        return page;
      }),
      catchError(() => {
        this.status.set('failed');
        return of(null);
      }),
    );
  }

  private loadLookups(): void {
    if (this.lookupsLoaded) return;
    this.lookupsLoaded = true;
    this.accountsService
      .list()
      .pipe(
        map((response) =>
          response.banks.flatMap((bank) =>
            [...bank.accounts, ...bank.closedAccounts]
              .filter((account) => !account.hidden && !account.savings)
              .map((account) => ({ id: account.id, label: account.name })),
          ),
        ),
        catchError(() => of([])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((accounts) => this.accounts.set(accounts));
    this.categoriesService
      .list()
      .pipe(
        catchError(() => of([])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((categories) => this.categories.set(categories));
  }

  protected closeSheet(): void {
    void this.router.navigate(['/transaktioner'], { queryParamsHandling: 'preserve' });
  }

  /** The new transaction belongs in the list, so the list is fetched again. */
  protected onAdded(): void {
    this.toast.show('Transaktionen sparades');
    this.closeSheet();
    this.load(this.filters()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  protected closePanel(): void {
    this.panelOpen.set(false);
    // Välj datum with no date picked changes nothing, so it should not stay chosen.
    if (this.filters().from === '' && this.filters().to === '') this.customDates.set(false);
  }

  protected openPanel(): void {
    this.loadLookups();
    this.panelOpen.set(true);
  }

  protected typeSearch(value: string): void {
    this.searchText.set(value);
    this.typed.next(value);
  }

  protected clearSearch(): void {
    this.searchText.set('');
    this.apply({ q: '' }, true);
  }

  /** Puts the change in the URL, which loads the list again. */
  protected apply(change: Partial<TransactionFilters>, replaceUrl = false): void {
    this.target = { ...this.target, ...change };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filtersToParams(this.target),
      replaceUrl,
    });
  }

  protected clearAll(): void {
    this.customDates.set(false);
    this.searchText.set('');
    this.apply({ ...EMPTY_FILTERS });
  }

  protected choosePeriod(key: string): void {
    this.customDates.set(key === 'custom');
    if (key === 'all') this.apply({ from: '', to: '' });
    else if (key === 'last7') this.apply(this.presets.last7);
    else if (key === 'month') this.apply(this.presets.month);
    else this.panelOpen.set(true);
    if (key === 'custom') this.loadLookups();
  }

  protected loadMore(): void {
    const before = this.cursor();
    if (before === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    this.moreRequest = this.service.list(before, this.filters()).subscribe({
      next: (page) => {
        this.transactions.update((shown) => [...shown, ...page.transactions]);
        this.cursor.set(page.nextCursor);
        this.count.set(page.count);
        this.sum.set(page.sum);
        this.remember();
        this.loadingMore.set(false);
      },
      error: () => {
        this.moreFailed.set(true);
        this.loadingMore.set(false);
      },
    });
  }

  private remember(): void {
    this.service.listed = {
      key: queryOf(this.filters()),
      transactions: this.transactions(),
      cursor: this.cursor(),
      count: this.count(),
      sum: this.sum(),
    };
  }

  private periodLabel(f: TransactionFilters): string {
    if (samePeriod(this.presets.last7, f)) return 'Senaste 7 dagarna';
    if (samePeriod(this.presets.month, f)) return this.monthLabel;
    if (f.from !== '' && f.to !== '') return `${shortDate(f.from)} – ${shortDate(f.to)}`;
    return f.from !== '' ? `Från ${shortDate(f.from)}` : `Till ${shortDate(f.to)}`;
  }

  private amountLabel(f: TransactionFilters): string {
    const preset = AMOUNT_PRESETS.find((p) => p.min === f.min && p.max === f.max);
    if (preset) return preset.label;
    if (f.min !== '' && f.max !== '') return `${f.min}–${f.max} kr`;
    return f.min !== '' ? `Minst ${f.min} kr` : `Högst ${f.max} kr`;
  }
}

function queryOf(filters: TransactionFilters): string {
  return new URLSearchParams(filtersToParams(filters)).toString();
}
