import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Category, Transaction } from '@bankapp/shared';
import { CategoriesService } from '../../categories.service';
import { CategoryPickerComponent } from '../../category-picker/category-picker';
import { TransactionCategoryBadge } from '../../category-icon/transaction-category-badge';
import { DateHeadingPipe } from '../../formatting/date-heading.pipe';
import { MoneyPipe } from '../../formatting/money.pipe';
import { TransactionsService } from '../../transactions.service';
import { similarUpdatedNote } from '../../similar-updated-note';

type Status = 'loading' | 'ready' | 'failed';

/** Guessed and uncategorised transactions, each with a quick way to settle its category. */
@Component({
  selector: 'app-review-page',
  imports: [
    RouterLink,
    DateHeadingPipe,
    MoneyPipe,
    TransactionCategoryBadge,
    CategoryPickerComponent,
  ],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      @switch (status()) {
        @case ('loading') {
          <p aria-live="polite">Hämtar transaktioner att granska…</p>
        }
        @case ('failed') {
          <p role="alert">Transaktionerna kunde inte hämtas. Försök igen senare.</p>
        }
        @default {
          <header>
            <h1 class="text-3xl font-semibold tracking-tight">Att granska</h1>
          </header>
          @if (transactions().length === 0) {
            <p data-empty>Inget att granska just nu.</p>
            <a routerLink="/" class="self-start font-medium underline">Till transaktionerna</a>
          }
          @if (error(); as message) {
            <p role="alert" class="text-sm text-red-700 dark:text-red-400">{{ message }}</p>
          }
          @if (similarNote(); as note) {
            <p
              data-similar-updated
              aria-live="polite"
              class="text-sm text-zinc-500 dark:text-zinc-400"
            >
              {{ note }}
            </p>
          }
          @for (group of groups(); track group.key) {
            <section
              [attr.data-group]="group.key"
              class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 class="text-lg font-semibold">{{ group.heading }}</h2>
              <ul class="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                @for (t of group.transactions; track t.id) {
                  <li data-transaction [attr.data-id]="t.id" class="py-3">
                    <div class="flex items-center gap-3">
                      <app-transaction-category-badge [category]="t.category" />
                      <a
                        [routerLink]="['/transaktioner', t.id]"
                        class="flex min-w-0 flex-1 flex-col"
                      >
                        <span data-description>{{ t.description }}</span>
                        <span data-meta class="text-sm text-zinc-500 dark:text-zinc-400"
                          >{{ t.date | dateHeading }} · {{ t.account.name }}</span
                        >
                        @if (t.category; as c) {
                          <span data-guess class="text-sm text-zinc-500 dark:text-zinc-400"
                            >{{ c.category.name }} / {{ c.subcategory.name }}</span
                          >
                        }
                      </a>
                      <span
                        data-amount
                        class="font-medium tabular-nums"
                        [class.text-emerald-600]="t.amount.amount > 0"
                        [class.dark:text-emerald-400]="t.amount.amount > 0"
                        >{{ t.amount.amount | money: t.amount.currency }}</span
                      >
                    </div>
                    <div class="mt-2 flex gap-3 pl-11">
                      @if (t.category; as c) {
                        <button
                          type="button"
                          data-confirm
                          class="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                          [disabled]="saving() === t.id"
                          (click)="save(t, c.subcategory.id)"
                        >
                          Stämmer
                        </button>
                      }
                      <button
                        type="button"
                        data-change
                        class="text-sm font-medium underline"
                        [attr.aria-expanded]="picking() === t.id"
                        (click)="togglePicker(t)"
                      >
                        {{ picking() === t.id ? 'Stäng' : t.category ? 'Ändra' : 'Välj kategori' }}
                      </button>
                    </div>
                    @if (picking() === t.id) {
                      <div class="mt-3 pl-11">
                        @if (categories(); as list) {
                          <app-category-picker [categories]="list" (picked)="save(t, $event)" />
                        } @else {
                          <p aria-live="polite">Hämtar kategorier…</p>
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
      }
    </main>
  `,
})
export class ReviewPage {
  private readonly service = inject(TransactionsService);
  private readonly categoryList = inject(CategoriesService);

  protected readonly status = signal<Status>('loading');
  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly picking = signal<number | null>(null);
  protected readonly saving = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly similarNote = signal<string | null>(null);
  /** Fetched the first time a picker opens. */
  protected readonly categories = signal<Category[] | null>(null);
  private loadingCategories = false;
  private refreshes = 0;

  /** Guesses first, then what has no category, each newest first as the server sent them. */
  protected readonly groups = computed(() =>
    [
      {
        key: 'guessed',
        heading: 'Gissade',
        transactions: this.transactions().filter((t) => t.category),
      },
      {
        key: 'uncategorised',
        heading: 'Okategoriserade',
        transactions: this.transactions().filter((t) => !t.category),
      },
    ].filter((group) => group.transactions.length > 0),
  );

  constructor() {
    this.service.review().subscribe({
      next: (response) => {
        this.transactions.set(response.transactions);
        this.status.set('ready');
      },
      error: () => this.status.set('failed'),
    });
  }

  /** Fetches the list again after a save changed other rows; a failure keeps what is shown. */
  private refresh(): void {
    const saves = ++this.refreshes;
    this.service.review().subscribe({
      // An answer that a later save has outdated would bring back a row confirmed meanwhile.
      next: (response) => {
        if (saves === this.refreshes && this.saving() === null) {
          this.transactions.set(response.transactions);
        }
      },
      error: () => undefined,
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
    if (this.saving() !== null) return; // one save at a time; the buttons are disabled meanwhile
    this.saving.set(transaction.id);
    this.refreshes += 1; // outdates any refresh still on its way
    this.error.set(null);
    this.similarNote.set(null);
    this.service.setCategory(transaction.id, subcategoryId).subscribe({
      next: ({ updatedSimilar }) => {
        this.transactions.update((shown) => shown.filter((t) => t.id !== transaction.id));
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
