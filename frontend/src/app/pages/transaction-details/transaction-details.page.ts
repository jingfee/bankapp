import { Location, formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AccountType, Category, Money, TransactionDetails } from '@bankapp/shared';
import { CategoriesService } from '../../categories.service';
import { CategoryPickerComponent } from '../../category-picker/category-picker';
import { TransactionCategoryBadge } from '../../category-icon/transaction-category-badge';
import { DateHeadingPipe } from '../../formatting/date-heading.pipe';
import { APP_LOCALE } from '../../formatting/locale';
import { MoneyPipe } from '../../formatting/money.pipe';
import { TransactionsService } from '../../transactions.service';

type State =
  { status: 'loading' | 'failed' | 'gone' } | { status: 'ready'; details: TransactionDetails };

interface Field {
  label: string;
  /** Marks the cell in tests and styling. */
  key: string;
  value: string;
}

const ACCOUNT_TYPES: Record<AccountType, string> = {
  payment: 'Betalkonto',
  savings: 'Sparkonto',
  card: 'Kortkonto',
};

/** The bank's currency code is not ours to trust: an unknown one is shown as sent. */
function formatOriginal({ amount, currency }: Money): string {
  try {
    return new Intl.NumberFormat(APP_LOCALE, { style: 'currency', currency }).format(amount);
  } catch {
    return `${formatNumber(amount, APP_LOCALE, '1.2-2')} ${currency}`;
  }
}

@Component({
  selector: 'app-transaction-details-page',
  imports: [RouterLink, MoneyPipe, TransactionCategoryBadge, CategoryPickerComponent],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      @switch (state().status) {
        @case ('loading') {
          <p aria-live="polite">Hämtar transaktionen…</p>
        }
        @case ('gone') {
          <h1 class="text-3xl font-semibold tracking-tight">Transaktionen finns inte längre</h1>
          <a routerLink="/" class="font-medium underline">Till transaktionerna</a>
        }
        @case ('failed') {
          <p role="alert">Transaktionen kunde inte hämtas. Försök igen senare.</p>
          <a routerLink="/" class="font-medium underline">Till transaktionerna</a>
        }
        @default {
          @if (details(); as t) {
            <button
              type="button"
              data-back
              class="self-start font-medium underline"
              (click)="back()"
            >
              ← Transaktioner
            </button>
            <header>
              <h1 data-description class="text-3xl font-semibold tracking-tight">
                {{ t.description || 'Transaktion' }}
              </h1>
              <p
                data-amount
                class="mt-1 text-2xl font-medium tabular-nums"
                [class.text-emerald-600]="t.amount.amount > 0"
                [class.dark:text-emerald-400]="t.amount.amount > 0"
              >
                {{ t.amount.amount | money: t.amount.currency }}
              </p>
            </header>
            <section
              data-category
              class="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  data-category-button
                  class="flex flex-1 items-center gap-3 text-left"
                  [attr.aria-expanded]="picking()"
                  [disabled]="saving()"
                  (click)="togglePicker()"
                >
                  <app-transaction-category-badge [category]="t.category" />
                  <span class="flex flex-1 flex-col">
                    <span
                      data-category-name
                      class="font-medium"
                      [class.text-zinc-500]="t.category?.confirmed === false"
                      [class.dark:text-zinc-400]="t.category?.confirmed === false"
                    >
                      @if (t.category; as c) {
                        {{ c.category.name }} / {{ c.subcategory.name }}
                      } @else {
                        Okategoriserad
                      }
                    </span>
                    @if (t.category?.confirmed === false) {
                      <span
                        data-category-guessed-note
                        class="text-sm text-zinc-500 dark:text-zinc-400"
                        >Gissad</span
                      >
                    }
                  </span>
                  <span class="text-sm text-zinc-500 dark:text-zinc-400">{{
                    picking() ? 'Stäng' : 'Ändra'
                  }}</span>
                </button>
              </div>
              @if (t.category; as c) {
                @if (!c.confirmed) {
                  <button
                    type="button"
                    data-confirm-category
                    class="self-start rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    [disabled]="saving()"
                    (click)="setCategory(c.subcategory.id)"
                  >
                    Stämmer
                  </button>
                }
                <button
                  type="button"
                  data-remove-category
                  class="self-start text-sm font-medium underline"
                  [disabled]="saving()"
                  (click)="setCategory(null)"
                >
                  Ta bort kategori
                </button>
              }
              @if (categoryError(); as error) {
                <p role="alert" class="text-sm text-red-700 dark:text-red-400">{{ error }}</p>
              }
              @if (picking()) {
                @if (categories(); as list) {
                  <app-category-picker [categories]="list" (picked)="setCategory($event)" />
                } @else {
                  <p aria-live="polite">Hämtar kategorier…</p>
                }
              }
            </section>
            <dl
              class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              @for (field of fields(); track field.key) {
                <dt class="text-zinc-500 dark:text-zinc-400">{{ field.label }}</dt>
                <dd [attr.data-field]="field.key" class="text-right break-words">
                  {{ field.value }}
                </dd>
              }
            </dl>
            <details
              data-raw
              class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <summary class="cursor-pointer font-medium">Rådata</summary>
              <pre data-raw-json class="mt-3 overflow-x-auto text-sm select-all">{{
                rawJson()
              }}</pre>
            </details>
          }
        }
      }
    </main>
  `,
})
export class TransactionDetailsPage {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly transactions = inject(TransactionsService);
  private readonly categoryList = inject(CategoriesService);

  protected readonly picking = signal(false);
  protected readonly saving = signal(false);
  protected readonly categoryError = signal<string | null>(null);
  /** Fetched the first time the picker opens. */
  protected readonly categories = signal<Category[] | null>(null);
  private loadingCategories = false;

  protected readonly state = signal<State>({ status: 'loading' });
  protected readonly details = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? state.details : null;
  });

  /** The fields shown above the dates, left out when the bank did not send them. */
  protected readonly fields = computed<Field[]>(() => {
    const t = this.details();
    if (t === null) return [];
    const fields: Field[] = [
      { label: 'Status', key: 'status', value: t.status === 'pending' ? 'Reserverad' : 'Bokförd' },
      { label: 'Bank', key: 'bank', value: t.account.bank },
      {
        label: 'Konto',
        key: 'account',
        value: `${t.account.name} (${ACCOUNT_TYPES[t.account.type]})`,
      },
    ];
    const day = new DateHeadingPipe();
    if (t.transactionDate) {
      fields.push({
        label: 'Transaktionsdatum',
        key: 'transactionDate',
        value: day.transform(t.transactionDate),
      });
    }
    if (t.bookingDate) {
      fields.push({
        label: 'Bokföringsdatum',
        key: 'bookingDate',
        value: day.transform(t.bookingDate),
      });
    }
    if (t.counterparty)
      fields.push({ label: 'Motpart', key: 'counterparty', value: t.counterparty });
    if (t.originalAmount) {
      fields.push({
        label: 'Ursprungligt belopp',
        key: 'originalAmount',
        value: formatOriginal(t.originalAmount),
      });
    }
    if (t.exchangeRate !== null) {
      fields.push({
        label: 'Växelkurs',
        key: 'exchangeRate',
        value: formatNumber(t.exchangeRate, APP_LOCALE, '1.0-6'),
      });
    }
    if (t.remittanceInformation.length > 0) {
      fields.push({
        label: 'Meddelande',
        key: 'remittanceInformation',
        value: t.remittanceInformation.join(' '),
      });
    }
    if (t.referenceNumber) {
      fields.push({ label: 'Referens', key: 'referenceNumber', value: t.referenceNumber });
    }
    if (t.note) fields.push({ label: 'Notering', key: 'note', value: t.note });
    return fields;
  });

  /** The stored raw JSON, indented; as stored if it somehow is not JSON. */
  protected readonly rawJson = computed(() => {
    const raw = this.details()?.raw ?? '';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  });

  constructor() {
    const id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
    this.transactions.get(id).subscribe({
      next: (details) => this.state.set({ status: 'ready', details }),
      error: (error: unknown) =>
        this.state.set({
          status: error instanceof HttpErrorResponse && error.status === 404 ? 'gone' : 'failed',
        }),
    });
  }

  protected togglePicker(): void {
    this.picking.update((open) => !open);
    this.categoryError.set(null);
    if (!this.picking() || this.categories() !== null || this.loadingCategories) return;
    this.loadingCategories = true;
    this.categoryList.list().subscribe({
      next: (list) => {
        this.categories.set(list);
        this.loadingCategories = false;
      },
      error: () => {
        this.picking.set(false);
        this.categoryError.set('Kategorierna kunde inte hämtas. Försök igen senare.');
        this.loadingCategories = false;
      },
    });
  }

  /** Saves the owner's choice as a confirmed category; null makes the transaction uncategorised. */
  protected setCategory(subcategoryId: number | null): void {
    const details = this.details();
    if (details === null || this.saving()) return;
    this.saving.set(true);
    this.categoryError.set(null);
    this.transactions.setCategory(details.id, subcategoryId).subscribe({
      next: (category) => {
        this.state.set({ status: 'ready', details: { ...details, category } });
        this.picking.set(false);
        this.saving.set(false);
      },
      error: () => {
        this.categoryError.set('Kategorin kunde inte sparas. Försök igen.');
        this.saving.set(false);
      },
    });
  }

  /** Steps back in history when the owner came from inside the app, so the list keeps its scroll position. */
  protected back(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) this.location.back();
    else void this.router.navigateByUrl('/');
  }
}
