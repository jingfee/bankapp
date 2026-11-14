import { similarUpdatedNote } from '../../similar-updated-note';
import { Location, formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import type {
  AccountType,
  Category,
  HouseholdRatioEntry,
  Money,
  ShareOption,
  Transaction,
  TransactionDetails,
} from '@bankapp/shared';
import { CategoriesService } from '../../categories.service';
import { CategoryPickerComponent } from '../../category-picker/category-picker';
import { TransactionCategoryBadge } from '../../category-icon/transaction-category-badge';
import { DateHeadingPipe } from '../../formatting/date-heading.pipe';
import { APP_LOCALE } from '../../formatting/locale';
import { MoneyPipe } from '../../formatting/money.pipe';
import { SharesService } from '../../shares.service';
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

const SHARE_OPTION_ORDER: ShareOption[] = ['me', 'half', 'household', 'partner'];

/** What each option is called when choosing; Hushåll adds the ratio, so it is built separately. */
const SHARE_CHOICE_LABELS: Record<Exclude<ShareOption, 'household'>, string> = {
  me: 'Jag',
  half: '50/50',
  partner: 'Partner betalar allt',
};

/** The household ratio in force on `date`: the latest entry from then or before, else the first. */
function ratioOn(entries: HouseholdRatioEntry[], date: string | null): number | null {
  const inForce = entries.filter((e) => date !== null && e.from <= date).at(-1) ?? entries[0];
  return inForce?.percent ?? null;
}

const householdLabel = (percent: number | null) =>
  percent === null ? 'Hushåll' : `Hushåll (${percent}/${100 - percent})`;

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
          <a routerLink="/transaktioner" class="font-medium underline">Till transaktionerna</a>
        }
        @case ('failed') {
          <p role="alert">Transaktionen kunde inte hämtas. Försök igen senare.</p>
          <a routerLink="/transaktioner" class="font-medium underline">Till transaktionerna</a>
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
              <h1
                data-description
                class="text-3xl [overflow-wrap:anywhere] font-semibold tracking-tight"
              >
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
                  [disabled]="saving() || t.offsets !== null"
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
                  @if (t.offsets === null) {
                    <span class="text-sm text-zinc-500 dark:text-zinc-400">{{
                      picking() ? 'Stäng' : 'Ändra'
                    }}</span>
                  }
                </button>
              </div>
              @if (t.category; as c) {
                @if (!c.confirmed && t.offsets === null) {
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
                @if (t.offsets === null) {
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
              }
              @if (categoryError(); as error) {
                <p role="alert" class="text-sm text-red-700 dark:text-red-400">{{ error }}</p>
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
              @if (picking()) {
                @if (categories(); as list) {
                  <app-category-picker [categories]="list" (picked)="setCategory($event)" />
                } @else {
                  <p aria-live="polite">Hämtar kategorier…</p>
                }
              }
            </section>
            <section
              data-share
              class="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 class="font-semibold">Andel</h2>
              <div class="flex justify-between gap-3">
                <span class="flex flex-col">
                  <span data-share-name class="font-medium">
                    {{ shareName() }}
                  </span>
                  <span data-share-source class="text-sm text-zinc-500 dark:text-zinc-400">
                    {{ shareSource() }}
                  </span>
                </span>
                <span class="flex flex-col items-end">
                  <span class="text-sm text-zinc-500 dark:text-zinc-400">Din del</span>
                  <span data-share-part class="tabular-nums">{{
                    ownerPart() | money: t.amount.currency
                  }}</span>
                </span>
              </div>
              @if (t.offsets; as purchase) {
                <a
                  data-share-purchase
                  [routerLink]="['/transaktioner', purchase.id]"
                  class="self-start text-sm font-medium underline"
                >
                  {{ purchase.description }}
                </a>
              } @else {
                <div class="flex items-center gap-4">
                  <button
                    type="button"
                    data-share-toggle
                    class="font-medium underline"
                    [attr.aria-expanded]="choosingShare()"
                    (click)="toggleShareChoices()"
                  >
                    {{ choosingShare() ? 'Stäng' : 'Ändra' }}
                  </button>
                  @if (t.share.source === 'transaction') {
                    <button
                      type="button"
                      data-remove-share
                      class="text-sm font-medium underline"
                      [disabled]="saving()"
                      (click)="setShare(null)"
                    >
                      Ta bort egen andel
                    </button>
                  }
                </div>
                @if (choosingShare()) {
                  <div role="group" aria-label="Välj andel" class="flex flex-col gap-1">
                    @for (choice of shareChoices(); track choice.option) {
                      <button
                        type="button"
                        [attr.data-share-option]="choice.option"
                        class="rounded-lg px-3 py-2 text-left hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                        [class.font-semibold]="choice.current"
                        [attr.aria-pressed]="choice.current"
                        [disabled]="saving() || choice.disabled"
                        (click)="setShare(choice.option)"
                      >
                        {{ choice.label }}
                      </button>
                    }
                  </div>
                  @if (ratio() !== null && ratio()!.length === 0) {
                    <p class="text-sm text-zinc-500 dark:text-zinc-400">
                      Hushåll kan väljas först när en hushållsandel har ställts in.
                    </p>
                  }
                }
              }
              @if (shareError(); as error) {
                <p data-share-error role="alert" class="text-sm text-red-700 dark:text-red-400">
                  {{ error }}
                </p>
              }
            </section>
            @if (t.offsets; as purchase) {
              <section
                data-offsets
                class="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h2 class="font-semibold">Kvittad mot</h2>
                <a
                  data-offsets-purchase
                  [routerLink]="['/transaktioner', purchase.id]"
                  class="flex justify-between gap-3 underline"
                >
                  <span class="min-w-0 [overflow-wrap:anywhere]">{{ purchase.description }}</span>
                  <span class="shrink-0 tabular-nums">{{
                    purchase.amount.amount | money: purchase.amount.currency
                  }}</span>
                </a>
                <p class="text-sm text-zinc-500 dark:text-zinc-400">
                  Räknas i köpets månad och följer köpets kategori.
                </p>
                <button
                  type="button"
                  data-remove-offset
                  class="self-start text-sm font-medium underline"
                  [disabled]="saving()"
                  (click)="setOffset(null)"
                >
                  Ta bort kvittning
                </button>
              </section>
            } @else if (t.amount.amount > 0 && t.status === 'booked') {
              <section
                data-offset-picker
                class="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <button
                  type="button"
                  data-offset-toggle
                  class="self-start font-medium underline"
                  [attr.aria-expanded]="offsetting()"
                  (click)="toggleOffset()"
                >
                  {{ offsetting() ? 'Stäng' : 'Kvitta mot ett köp' }}
                </button>
                @if (offsetting()) {
                  <input
                    data-offset-search
                    type="search"
                    placeholder="Sök köp"
                    aria-label="Sök köp"
                    class="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                    [value]="offsetSearch()"
                    (input)="searchOffsets($any($event.target).value)"
                  />
                  @if (offsetCandidates(); as candidates) {
                    @if (candidates.length === 0) {
                      <p data-offset-empty>
                        {{
                          offsetSearch().trim()
                            ? 'Inga träffar'
                            : 'Inga troliga köp. Sök efter ett.'
                        }}
                      </p>
                    }
                    <ul>
                      @for (candidate of candidates; track candidate.id) {
                        <li>
                          <button
                            type="button"
                            [attr.data-offset-candidate]="candidate.id"
                            class="flex w-full justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            [disabled]="saving()"
                            (click)="setOffset(candidate.id)"
                          >
                            <span class="flex min-w-0 flex-col [overflow-wrap:anywhere]">
                              <span>{{ candidate.description }}</span>
                              <span class="text-sm text-zinc-500 dark:text-zinc-400">{{
                                candidate.date
                              }}</span>
                            </span>
                            <span class="shrink-0 tabular-nums">{{
                              candidate.amount.amount | money: candidate.amount.currency
                            }}</span>
                          </button>
                        </li>
                      }
                    </ul>
                  } @else {
                    <p aria-live="polite">Hämtar köp…</p>
                  }
                }
              </section>
            }
            @if (t.refunds.length > 0 && t.netAmount; as net) {
              <section
                data-refunds
                class="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <h2 class="font-semibold">Kvitterat av</h2>
                <ul class="flex flex-col gap-1">
                  @for (refund of t.refunds; track refund.id) {
                    <li>
                      <a
                        [attr.data-refund]="refund.id"
                        [routerLink]="['/transaktioner', refund.id]"
                        class="flex justify-between gap-3 underline"
                      >
                        <span class="min-w-0 [overflow-wrap:anywhere]">{{
                          refund.description
                        }}</span>
                        <span class="shrink-0 tabular-nums">{{
                          refund.amount.amount | money: refund.amount.currency
                        }}</span>
                      </a>
                    </li>
                  }
                </ul>
                <p class="flex justify-between font-medium">
                  <span>Netto</span>
                  <span data-net-amount class="tabular-nums">{{
                    net.amount | money: net.currency
                  }}</span>
                </p>
              </section>
            }
            <dl
              class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 sm:gap-x-6 gap-y-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              @for (field of fields(); track field.key) {
                <dt class="text-zinc-500 dark:text-zinc-400">{{ field.label }}</dt>
                <dd [attr.data-field]="field.key" class="text-right [overflow-wrap:anywhere]">
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
  private readonly sharesService = inject(SharesService);

  protected readonly picking = signal(false);
  protected readonly saving = signal(false);
  protected readonly categoryError = signal<string | null>(null);
  protected readonly similarNote = signal<string | null>(null);
  /** Fetched the first time the picker opens. */
  protected readonly categories = signal<Category[] | null>(null);
  private loadingCategories = false;

  protected readonly choosingShare = signal(false);
  protected readonly shareError = signal<string | null>(null);
  /** The household ratio, fetched when the options are first opened; null until then. */
  protected readonly ratio = signal<HouseholdRatioEntry[] | null>(null);
  private loadingRatio = false;
  private shareRequest: Subscription | undefined;

  protected readonly offsetting = signal(false);
  protected readonly offsetSearch = signal('');
  /** Null while the candidates are being fetched. */
  protected readonly offsetCandidates = signal<Transaction[] | null>(null);
  private candidateRequest: Subscription | undefined;
  private loadRequest: Subscription | undefined;

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
    // Following a link to the linked purchase or refund keeps this page and changes the id.
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params) => this.load(params.get('id') ?? ''));
  }

  private load(id: string): void {
    this.state.set({ status: 'loading' });
    this.candidateRequest?.unsubscribe();
    this.loadRequest?.unsubscribe();
    this.shareRequest?.unsubscribe();
    this.saving.set(false);
    this.offsetting.set(false);
    this.offsetCandidates.set(null);
    this.categoryError.set(null);
    this.similarNote.set(null);
    this.picking.set(false);
    this.choosingShare.set(false);
    this.shareError.set(null);
    this.loadRequest = this.transactions.get(id).subscribe({
      next: (details) => this.state.set({ status: 'ready', details }),
      error: (error: unknown) =>
        this.state.set({
          status: error instanceof HttpErrorResponse && error.status === 404 ? 'gone' : 'failed',
        }),
    });
  }

  /** The effective share, named the way the options are: Hushåll shows its ratio. */
  protected readonly shareName = computed(() => {
    const share = this.details()?.share;
    if (share === undefined) return '';
    return share.option === 'household'
      ? householdLabel(share.percent)
      : SHARE_CHOICE_LABELS[share.option];
  });

  protected readonly shareSource = computed(() => {
    const t = this.details();
    if (t === null) return '';
    switch (t.share.source) {
      case 'account':
        return `från konto ${t.account.name}`;
      case 'subcategory':
        return `från underkategori ${t.category?.subcategory.name ?? ''}`;
      case 'transaction':
        return 'satt manuellt';
      case 'purchase':
        return 'andel från köpet';
      case 'default':
        return 'ingen andel vald';
    }
  });

  /** The owner's part of the amount, signed like the amount. */
  protected readonly ownerPart = computed(() => {
    const t = this.details();
    return t === null ? 0 : Math.round(t.amount.amount * t.share.percent) / 100 + 0;
  });

  protected readonly shareChoices = computed(() => {
    const t = this.details();
    const entries = this.ratio();
    const percent = t === null || entries === null ? null : ratioOn(entries, t.transactionDate);
    return SHARE_OPTION_ORDER.map((option) => ({
      option,
      current: t?.share.option === option,
      label: option === 'household' ? householdLabel(percent) : SHARE_CHOICE_LABELS[option],
      disabled: option === 'household' && (entries === null || entries.length === 0),
    }));
  });

  protected toggleShareChoices(): void {
    this.choosingShare.update((open) => !open);
    this.shareError.set(null);
    if (!this.choosingShare() || this.ratio() !== null || this.loadingRatio) return;
    this.loadingRatio = true;
    this.sharesService.householdRatio().subscribe({
      next: (entries) => {
        this.ratio.set(entries);
        this.loadingRatio = false;
      },
      error: () => {
        this.loadingRatio = false;
      },
    });
  }

  /** Sets the transaction's own share; null removes it so the inherited share applies. */
  protected setShare(share: ShareOption | null): void {
    const details = this.details();
    if (details === null || this.saving()) return;
    this.saving.set(true);
    this.shareError.set(null);
    this.shareRequest = this.transactions.setShare(details.id, share).subscribe({
      next: (updated) => {
        this.state.set({ status: 'ready', details: updated });
        this.choosingShare.set(false);
        this.saving.set(false);
      },
      error: () => {
        this.shareError.set('Andelen kunde inte sparas. Försök igen.');
        this.saving.set(false);
      },
    });
  }

  protected toggleOffset(): void {
    this.offsetting.update((open) => !open);
    this.categoryError.set(null);
    if (this.offsetting()) this.searchOffsets('');
  }

  protected searchOffsets(text: string): void {
    const details = this.details();
    if (details === null) return;
    this.offsetSearch.set(text);
    this.offsetCandidates.set(null);
    this.candidateRequest?.unsubscribe();
    this.candidateRequest = this.transactions.offsetCandidates(details.id, text).subscribe({
      next: ({ transactions }) => this.offsetCandidates.set(transactions),
      error: () => {
        this.offsetting.set(false);
        this.categoryError.set('Köpen kunde inte hämtas. Försök igen senare.');
      },
    });
  }

  /** Offsets this refund against a purchase, or removes the link with null. */
  protected setOffset(purchaseId: number | null): void {
    const details = this.details();
    if (details === null || this.saving()) return;
    this.saving.set(true);
    this.categoryError.set(null);
    this.transactions.setOffset(details.id, purchaseId).subscribe({
      next: (updated) => {
        this.state.set({ status: 'ready', details: updated });
        this.offsetting.set(false);
        this.saving.set(false);
      },
      error: () => {
        this.categoryError.set('Kvittningen kunde inte sparas. Försök igen.');
        this.saving.set(false);
      },
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
    this.similarNote.set(null);
    this.transactions.setCategory(details.id, subcategoryId).subscribe({
      next: ({ category, updatedSimilar }) => {
        this.state.set({ status: 'ready', details: { ...details, category } });
        this.similarNote.set(similarUpdatedNote(updatedSimilar));
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
    else void this.router.navigateByUrl('/transaktioner');
  }
}
