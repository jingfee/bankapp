import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CATEGORY_PALETTE,
  type Category,
  type CategoryColour,
  type ReplacementSuggestion,
  type Transaction,
} from '@bankapp/shared';
import { CategoriesService } from '../../categories.service';
import { CategoryPickerComponent } from '../../category-picker/category-picker';
import { CategoryIconComponent } from '../../category-icon/category-icon';
import { TransactionCategoryBadge } from '../../category-icon/transaction-category-badge';
import { DateHeadingPipe } from '../../formatting/date-heading.pipe';
import { MoneyPipe } from '../../formatting/money.pipe';
import { accountLabel } from '../../share-display';
import { TransactionsService } from '../../transactions.service';
import { similarUpdatedNote } from '../../similar-updated-note';

type Status = 'loading' | 'ready' | 'failed';

/** Rows shown before Visa alla. */
const VISIBLE_ROWS = 5;
/** How long a handled row takes to collapse away; matches `.collapsible` in styles.css. */
const COLLAPSE_MS = 450;

/** Guessed and uncategorised transactions, each with a quick way to settle its category. */
@Component({
  selector: 'app-review-page',
  imports: [
    RouterLink,
    DateHeadingPipe,
    MoneyPipe,
    TransactionCategoryBadge,
    CategoryIconComponent,
    CategoryPickerComponent,
  ],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:py-10">
      @switch (status()) {
        @case ('loading') {
          <p aria-live="polite">Hämtar transaktioner att granska…</p>
        }
        @case ('failed') {
          <p role="alert">Transaktionerna kunde inte hämtas. Försök igen senare.</p>
        }
        @default {
          <header class="flex flex-col gap-3">
            <div class="flex items-baseline justify-between gap-3">
              <h1 class="font-display text-3xl font-semibold tracking-tight">Att granska</h1>
              @if (remaining() > 0) {
                <p data-remaining class="text-sm text-muted" aria-live="polite">
                  {{ remaining() }} kvar att bekräfta
                </p>
              }
            </div>
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
            <section
              data-empty
              class="card flex flex-col items-center gap-3 px-6 py-10 text-center"
            >
              <span
                aria-hidden="true"
                class="grid size-12 place-content-center rounded-full bg-positive/15 text-positive"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <p class="text-lg font-semibold">Allt är granskat</p>
              <a routerLink="/" class="btn btn-secondary mt-2">Till översikten</a>
            </section>
          }
          @if (error(); as message) {
            <p role="alert" class="text-sm text-danger">{{ message }}</p>
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
                                >{{ t.date | dateHeading }} · {{ accountLabel(t) }}</span
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
                          [disabled]="deciding() !== null"
                          (click)="decide(pair, 'replace')"
                        >
                          Ersätt med banktransaktionen
                        </button>
                        <button
                          type="button"
                          data-not-same
                          class="btn btn-secondary btn-sm"
                          [disabled]="deciding() !== null"
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
                                >{{ t.date | dateHeading }} · {{ accountLabel(t) }}</span
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
                                [disabled]="saving() === t.id"
                                (click)="save(t, c.subcategory.id)"
                              >
                                Stämmer
                              </button>
                            }
                            <button
                              type="button"
                              data-change
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
                              <app-category-picker [categories]="list" (picked)="save(t, $event)" />
                            } @else {
                              <p aria-live="polite">Hämtar kategorier…</p>
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
    </main>
  `,
})
export class ReviewPage {
  private readonly service = inject(TransactionsService);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly categoryList = inject(CategoriesService);

  protected readonly accountLabel = accountLabel;
  protected readonly status = signal<Status>('loading');
  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly replacements = signal<ReplacementSuggestion[]>([]);
  protected readonly deciding = signal<number | null>(null);
  protected readonly picking = signal<number | null>(null);
  protected readonly saving = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly similarNote = signal<string | null>(null);
  /** Fetched the first time a picker opens. */
  protected readonly categories = signal<Category[] | null>(null);
  private loadingCategories = false;
  private refreshes = 0;

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

  /** Marks a row as handled; it collapses, then is dropped from `remove`'s list. */
  private collapse(set: typeof this.leaving, id: number, remove: () => void): void {
    set.update((ids) => new Set(ids).add(id));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      remove();
      set.update((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }, COLLAPSE_MS);
    this.timers.add(timer);
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
    this.service.review().subscribe({
      next: (response) => {
        this.transactions.set(response.transactions);
        this.replacements.set(response.replacements);
        this.initialTotal.set(response.transactions.length + response.replacements.length);
        this.status.set('ready');
      },
      error: () => this.status.set('failed'),
    });
  }

  /** Fetches the list again after a save changed other rows; a failure keeps what is shown. */
  private refresh(withReplacements = false): void {
    const saves = ++this.refreshes;
    this.service.review().subscribe({
      // An answer that a later save has outdated would bring back a row confirmed meanwhile.
      next: (response) => {
        if (saves === this.refreshes && this.saving() === null) {
          // Rows still collapsing away stay until they have gone.
          const fading = this.transactions().filter(
            (t) => this.leaving().has(t.id) && !response.transactions.some((r) => r.id === t.id),
          );
          this.transactions.set([...fading, ...response.transactions]);
          if (withReplacements) {
            const fadingPairs = this.replacements().filter(
              (p) =>
                this.leavingPairs().has(p.bank.id) &&
                !response.replacements.some((r) => r.bank.id === p.bank.id),
            );
            this.replacements.set([...fadingPairs, ...response.replacements]);
          }
        }
      },
      error: () => undefined,
    });
  }

  /** Replaces the manual transaction with the bank one, or says they are not the same. */
  protected decide(pair: ReplacementSuggestion, choice: 'replace' | 'notSame'): void {
    if (this.deciding() !== null || this.leavingPairs().has(pair.bank.id)) return;
    this.deciding.set(pair.bank.id);
    this.error.set(null);
    const request = { manualId: pair.manual.id, bankId: pair.bank.id };
    this.service[choice](request).subscribe({
      next: () => {
        this.collapse(this.leavingPairs, pair.bank.id, () =>
          this.replacements.update((shown) => shown.filter((p) => p.bank.id !== pair.bank.id)),
        );
        this.deciding.set(null);
        // The bank transaction is confirmed by Ersätt, and other pairs may change.
        this.refresh(true);
      },
      error: () => {
        this.error.set('Det gick inte att spara. Försök igen.');
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
    this.refreshes += 1; // outdates any refresh still on its way
    this.error.set(null);
    this.similarNote.set(null);
    this.service.setCategory(transaction.id, subcategoryId).subscribe({
      next: ({ updatedSimilar }) => {
        this.collapse(this.leaving, transaction.id, () =>
          this.transactions.update((shown) => shown.filter((t) => t.id !== transaction.id)),
        );
        this.service.reviewCount.update((count) => Math.max(0, count - 1));
        if (this.picking() === transaction.id) this.picking.set(null);
        this.saving.set(null);
        this.similarNote.set(similarUpdatedNote(updatedSimilar));
        // The similar ones stay in the list but with the new guess.
        if (updatedSimilar > 0) this.refresh();
      },
      error: () => {
        this.error.set('Kategorin kunde inte sparas. Försök igen.');
        this.saving.set(null);
      },
    });
  }
}
