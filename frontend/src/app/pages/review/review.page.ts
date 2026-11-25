import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_PALETTE,
  type Category,
  type CategoryColour,
  type ReplacementSuggestion,
  type Transaction,
} from '@bankapp/shared';
import { CategoriesService } from '../../categories.service';
import { CategoryTiles } from '../../category-tiles/category-tiles';
import { CategoryIconComponent } from '../../category-icon/category-icon';
import { TransactionCategoryBadge } from '../../category-icon/transaction-category-badge';
import { ShortDatePipe } from '../../formatting/short-date.pipe';
import { MoneyPipe } from '../../formatting/money.pipe';
import { accountLabel } from '../../share-display';
import { TransactionsStore } from '../../stores/transactions.store';
import { similarUpdatedNote } from '../../similar-updated-note';
import { Callout } from '../../callout/callout';
import { Empty } from '../../empty/empty';
import { OfflineDisabled } from '../../offline/offline-disabled';
import { Offline, saveFailureMessage } from '../../offline/offline.service';
import { Page } from '../../page/page';
import { Skeleton } from '../../skeleton/skeleton';

/** Rows shown before Visa alla. */
const VISIBLE_ROWS = 5;
/** How long a handled row takes to collapse away; matches `.collapsible` in styles.css. */
const COLLAPSE_MS = 450;

/** Guessed and uncategorised transactions, each with a quick way to settle its category. */
@Component({
  selector: 'app-review-page',
  imports: [
    RouterLink,
    ShortDatePipe,
    MoneyPipe,
    TransactionCategoryBadge,
    CategoryIconComponent,
    CategoryTiles,
    Page,
    Callout,
    Empty,
    Skeleton,
    OfflineDisabled,
  ],
  template: `
    <app-page width="narrow" title="Att granska" [fetchedAt]="fetchedAt()">
      @if (status() === 'ready' && remaining() > 0) {
        <p page-subtitle data-remaining class="text-sm text-muted" aria-live="polite">
          {{ remaining() }} kvar att bekräfta
        </p>
      }
      @switch (status()) {
        @case ('loading') {
          <div aria-busy="true"><app-skeleton [count]="5" /></div>
        }
        @case ('failed') {
          <app-callout variant="danger"
            >Transaktionerna kunde inte hämtas. Försök igen senare.</app-callout
          >
        }
        @default {
          <header class="flex flex-col gap-3">
            @if (total() > 0 && !finished()) {
              <div
                data-progress
                class="progress"
                role="progressbar"
                aria-label="Granskat"
                aria-valuemin="0"
                [attr.aria-valuemax]="total()"
                [attr.aria-valuenow]="done()"
              >
                <span [style.width.%]="(done() / total()) * 100"></span>
              </div>
            }
          </header>
          @if (finished()) {
            <app-empty data-empty icon="check" text="Allt är granskat">
              <a empty-action routerLink="/" class="btn btn-secondary">Till översikten</a>
            </app-empty>
          }
          @if (error(); as message) {
            <app-callout variant="danger">{{ message }}</app-callout>
          }
          @if (similarNote(); as note) {
            <p data-similar-updated aria-live="polite" class="text-sm text-muted">
              {{ note }}
            </p>
          }
          @if (replacements().length > 0) {
            <section data-replacements class="flex flex-col gap-3">
              <div>
                <h2 class="text-lg font-semibold">Samma köp?</h2>
                <p data-section-count class="text-sm text-muted">
                  {{ openReplacements() }} förslag · en manuell transaktion som verkar ha kommit
                  från banken
                </p>
              </div>
              @for (pair of replacements(); track pair.bank.id) {
                <div
                  data-replacement
                  class="collapsible"
                  [attr.data-manual]="pair.manual.id"
                  [attr.data-leaving]="leavingPairs().has(pair.bank.id) ? '' : null"
                  [attr.inert]="leavingPairs().has(pair.bank.id) ? '' : null"
                >
                  <div>
                    <div class="card flex flex-col gap-4 p-4">
                      <div class="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
                        @for (t of [pair.manual, pair.bank]; track t.id; let first = $first) {
                          <a
                            data-replacement-row
                            [routerLink]="['/transaktioner', t.id]"
                            class="flex min-w-0 items-center gap-3 rounded-xl bg-surface-2 p-3"
                          >
                            <app-transaction-category-badge
                              [category]="t.category"
                              [pending]="t.status === 'pending'"
                              [size]="28"
                            />
                            <span class="flex min-w-0 flex-1 flex-col">
                              <span data-description class="truncate font-medium">{{
                                t.description
                              }}</span>
                              <span data-meta class="truncate text-sm text-muted"
                                >{{ t.date | shortDate }} · {{ accountLabel(t) }}</span
                              >
                            </span>
                            <span data-amount class="amount shrink-0">{{
                              t.amount.amount | money: t.amount.currency
                            }}</span>
                          </a>
                          @if (first) {
                            <span
                              aria-hidden="true"
                              class="mx-auto grid size-7 place-content-center rounded-full bg-surface-3 text-muted"
                              >≈</span
                            >
                          }
                        }
                      </div>
                      <div class="flex flex-wrap gap-3">
                        <button
                          type="button"
                          data-replace
                          class="btn btn-primary btn-sm"
                          [appOfflineDisabled]="deciding() !== null"
                          (click)="decide(pair, 'replace')"
                        >
                          Ersätt med banktransaktionen
                        </button>
                        <button
                          type="button"
                          data-not-same
                          class="btn btn-secondary btn-sm"
                          [appOfflineDisabled]="deciding() !== null"
                          (click)="decide(pair, 'notSame')"
                        >
                          Inte samma
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </section>
          }
          @if (transactions().length > 0) {
            <section data-categories class="flex flex-col gap-3">
              <div>
                <h2 class="text-lg font-semibold">Bekräfta kategori</h2>
                <p data-section-count class="text-sm text-muted">
                  {{ openTransactions().length }} gissade eller okategoriserade
                </p>
              </div>
              <ul class="card p-1 sm:p-2">
                @for (t of visibleRows(); track t.id) {
                  <li
                    data-transaction
                    class="collapsible"
                    [attr.data-id]="t.id"
                    [attr.data-leaving]="leaving().has(t.id) ? '' : null"
                    [attr.inert]="leaving().has(t.id) ? '' : null"
                  >
                    <div>
                      <div class="border-b border-line px-2 py-3 sm:px-3">
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-3">
                          <div class="flex min-w-0 flex-1 basis-60 items-start gap-3">
                            <app-transaction-category-badge
                              class="mt-0.5 shrink-0"
                              [category]="t.category && { ...t.category, confirmed: true }"
                              [pending]="t.status === 'pending'"
                              [size]="36"
                            />
                            <a
                              [routerLink]="['/transaktioner', t.id]"
                              class="flex min-w-0 flex-1 flex-col gap-1"
                            >
                              <span data-description class="truncate font-medium">{{
                                t.description
                              }}</span>
                              <span data-meta class="text-sm text-muted"
                                >{{ t.date | shortDate }} · {{ accountLabel(t) }}</span
                              >
                              @if (t.category; as c) {
                                <span
                                  data-guess-tag
                                  class="guess-tag self-start"
                                  [style.--category-colour]="palette(c.category.colour).colour"
                                  [style.--category-tint]="palette(c.category.colour).tint"
                                >
                                  <app-category-icon
                                    [icon]="c.subcategory.icon"
                                    [colour]="c.category.colour"
                                    [size]="18"
                                  />
                                  Gissad: {{ c.subcategory.name }}
                                </span>
                              } @else {
                                <span data-guess-tag class="guess-tag guess-tag-none self-start"
                                  >Ingen gissning</span
                                >
                              }
                            </a>
                            <span
                              data-amount
                              class="amount shrink-0"
                              [class.text-positive]="t.amount.amount > 0"
                              >{{ t.amount.amount | money: t.amount.currency }}</span
                            >
                          </div>
                          <div class="flex w-full gap-2 sm:w-auto">
                            @if (t.category; as c) {
                              <button
                                type="button"
                                data-confirm
                                class="btn btn-positive btn-sm max-sm:flex-1"
                                [appOfflineDisabled]="saving() === t.id"
                                (click)="save(t, c.subcategory.id)"
                              >
                                Stämmer
                              </button>
                            }
                            <button
                              type="button"
                              data-change
                              appOfflineDisabled
                              class="btn btn-secondary btn-sm max-sm:flex-1"
                              [attr.aria-expanded]="picking() === t.id"
                              (click)="togglePicker(t)"
                            >
                              {{
                                picking() === t.id
                                  ? 'Stäng'
                                  : t.category
                                    ? 'Ändra'
                                    : 'Välj kategori'
                              }}
                            </button>
                          </div>
                        </div>
                        @if (picking() === t.id) {
                          <div class="mt-3">
                            @if (categories(); as list) {
                              <app-category-tiles
                                [categories]="list"
                                [current]="t.category?.subcategory?.id ?? null"
                                [searchable]="true"
                                (picked)="save(t, $event)"
                              />
                            } @else {
                              <div aria-busy="true"><app-skeleton shape="card" /></div>
                            }
                          </div>
                        }
                      </div>
                    </div>
                  </li>
                }
              </ul>
              @if (hiddenCount() > 0) {
                <button
                  type="button"
                  data-show-all
                  class="btn btn-secondary self-center"
                  (click)="showAll.set(true)"
                >
                  Visa alla {{ openTransactions().length }}
                </button>
              }
            </section>
          }
        }
      }
    </app-page>
  `,
})
export class ReviewPage {
  private readonly store = inject(TransactionsStore);
  private readonly review = this.store.review();
  /** When the device fetched what the page shows; the page says so while offline. */
  protected readonly fetchedAt = computed(() => [this.review.fetchedAt()]);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly categoryList = inject(CategoriesService);
  private readonly offline = inject(Offline);

  protected readonly accountLabel = accountLabel;
  protected readonly status = computed(() =>
    this.review.value() !== undefined ? 'ready' : this.review.failed() ? 'failed' : 'loading',
  );
  /** Rows handled this visit that have collapsed away; the store may not have dropped them yet. */
  private readonly dropped = signal<ReadonlySet<number>>(new Set());
  private readonly droppedPairs = signal<ReadonlySet<number>>(new Set());
  /** The rows collapsing away, kept so they stay once the store has dropped them. */
  private readonly fading = signal<ReadonlyMap<number, Transaction>>(new Map());
  private readonly fadingPairs = signal<ReadonlyMap<number, ReplacementSuggestion>>(new Map());
  protected readonly transactions = computed(() => {
    const read = this.review.value()?.transactions ?? [];
    return [
      ...[...this.fading().values()].filter((t) => !read.some((r) => r.id === t.id)),
      ...read.filter((t) => !this.dropped().has(t.id)),
    ];
  });
  protected readonly replacements = computed(() => {
    const read = this.review.value()?.replacements ?? [];
    return [
      ...[...this.fadingPairs().values()].filter((p) => !read.some((r) => r.bank.id === p.bank.id)),
      ...read.filter((p) => !this.droppedPairs().has(p.bank.id)),
    ];
  });
  protected readonly deciding = signal<number | null>(null);
  protected readonly picking = signal<number | null>(null);
  protected readonly saving = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly similarNote = signal<string | null>(null);
  /** Fetched the first time a picker opens. */
  protected readonly categories = signal<Category[] | null>(null);
  private loadingCategories = false;

  /** Rows handled this visit that are collapsing away; they leave the lists once done. */
  protected readonly leaving = signal<ReadonlySet<number>>(new Set());
  protected readonly leavingPairs = signal<ReadonlySet<number>>(new Set());
  protected readonly showAll = signal(false);
  /** The most there was to review at once this visit; the progress bar's full length. */
  private readonly initialTotal = signal(0);

  /** Guesses first, then what has no category, each newest first as the server sent them. */
  private readonly rows = computed(() => [
    ...this.transactions().filter((t) => t.category),
    ...this.transactions().filter((t) => !t.category),
  ]);
  protected readonly openTransactions = computed(() =>
    this.rows().filter((t) => !this.leaving().has(t.id)),
  );
  protected readonly openReplacements = computed(
    () => this.replacements().filter((p) => !this.leavingPairs().has(p.bank.id)).length,
  );
  protected readonly remaining = computed(
    () => this.openTransactions().length + this.openReplacements(),
  );
  protected readonly total = computed(() => Math.max(this.initialTotal(), this.remaining()));
  protected readonly done = computed(() => this.total() - this.remaining());
  /** Nothing open, and nothing still collapsing away. */
  protected readonly finished = computed(
    () => this.remaining() === 0 && this.leaving().size === 0 && this.leavingPairs().size === 0,
  );

  /** The first open rows, plus the ones collapsing away so the next row moves up at once. */
  protected readonly visibleRows = computed(() => {
    if (this.showAll()) return this.rows();
    let open = 0;
    return this.rows().filter((t) => this.leaving().has(t.id) || open++ < VISIBLE_ROWS);
  });
  protected readonly hiddenCount = computed(() =>
    this.showAll() ? 0 : Math.max(0, this.openTransactions().length - VISIBLE_ROWS),
  );

  protected palette(colour: CategoryColour) {
    return CATEGORY_PALETTE[colour];
  }

  /** Marks a row as handled; it collapses, then leaves the list for good. */
  private collapse<T>(
    leaving: typeof this.leaving,
    held: { update: (change: (m: ReadonlyMap<number, T>) => ReadonlyMap<number, T>) => void },
    dropped: typeof this.dropped,
    id: number,
    row: T,
  ): void {
    leaving.update((ids) => new Set(ids).add(id));
    held.update((rows) => new Map(rows).set(id, row));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      // Hidden even if the store has not yet answered with the list without it.
      dropped.update((ids) => new Set(ids).add(id));
      held.update((rows) => {
        const next = new Map(rows);
        next.delete(id);
        return next;
      });
      leaving.update((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }, COLLAPSE_MS);
    this.timers.add(timer);
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
    // A picker left open when the app goes offline closes: a change cannot be made from it.
    effect(() => {
      if (this.offline.isOffline()) untracked(() => this.picking.set(null));
    });
    effect(() => {
      const value = this.review.value();
      if (value === undefined) return;
      untracked(() => {
        if (this.initialTotal() === 0)
          this.initialTotal.set(value.transactions.length + value.replacements.length);
      });
    });
  }

  /** Replaces the manual transaction with the bank one, or says they are not the same. */
  protected decide(pair: ReplacementSuggestion, choice: 'replace' | 'notSame'): void {
    if (this.deciding() !== null || this.leavingPairs().has(pair.bank.id)) return;
    this.deciding.set(pair.bank.id);
    this.error.set(null);
    const request = { manualId: pair.manual.id, bankId: pair.bank.id };
    this.store[choice](request).subscribe({
      next: () => {
        this.collapse(this.leavingPairs, this.fadingPairs, this.droppedPairs, pair.bank.id, pair);
        this.deciding.set(null);
      },
      error: (error: unknown) => {
        this.error.set(saveFailureMessage(error, 'Det gick inte att spara. Försök igen.'));
        this.deciding.set(null);
      },
    });
  }

  protected togglePicker(transaction: Transaction): void {
    this.error.set(null);
    this.picking.update((open) => (open === transaction.id ? null : transaction.id));
    if (this.picking() === null || this.categories() !== null || this.loadingCategories) return;
    this.loadingCategories = true;
    this.categoryList.list().subscribe({
      next: (list) => {
        this.categories.set(list);
        this.loadingCategories = false;
      },
      error: () => {
        this.picking.set(null);
        this.error.set('Kategorierna kunde inte hämtas. Försök igen senare.');
        this.loadingCategories = false;
      },
    });
  }

  /** Saves the subcategory as confirmed; the transaction then leaves the list. */
  protected save(transaction: Transaction, subcategoryId: number): void {
    if (this.saving() !== null || this.leaving().has(transaction.id)) return; // one save at a time; the buttons are disabled meanwhile
    this.saving.set(transaction.id);
    this.error.set(null);
    this.similarNote.set(null);
    this.store.setCategory(transaction.id, subcategoryId).subscribe({
      next: ({ updatedSimilar }) => {
        this.collapse(this.leaving, this.fading, this.dropped, transaction.id, transaction);
        if (this.picking() === transaction.id) this.picking.set(null);
        this.saving.set(null);
        this.similarNote.set(similarUpdatedNote(updatedSimilar));
      },
      error: (error: unknown) => {
        this.error.set(saveFailureMessage(error, 'Kategorin kunde inte sparas. Försök igen.'));
        this.saving.set(null);
      },
    });
  }
}
