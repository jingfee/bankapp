import { similarUpdatedNote } from '../../similar-updated-note';
import { Location, formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { type Subscription, map } from 'rxjs';
import type {
  AccountType,
  Category,
  Money,
  ShareOption,
  Transaction,
  TransactionDetails,
} from '@bankapp/shared';
import { Callout } from '../../callout/callout';
import { Confirm } from '../../confirm/confirm';
import { Menu, MenuItem } from '../../menu/menu';
import { Sheet } from '../../sheet/sheet';
import { ShortDatePipe } from '../../formatting/short-date.pipe';
import { CategoriesService } from '../../categories.service';
import { CategoryTiles } from '../../category-tiles/category-tiles';
import { ManualTransactionSheet } from '../../manual-transaction-sheet/manual-transaction-sheet';
import { TransactionCategoryBadge } from '../../category-icon/transaction-category-badge';
import { DateHeadingPipe } from '../../formatting/date-heading.pipe';
import { APP_LOCALE } from '../../formatting/locale';
import { Disclosure } from '../../disclosure/disclosure';
import { Icon } from '../../icon/icon';
import { Skeleton } from '../../skeleton/skeleton';
import { ShareControl } from '../../share-control/share-control';
import { MoneyPipe } from '../../formatting/money.pipe';
import { SharesStore } from '../../stores/shares.store';
import { MANUAL_LABEL, SHARE_LABELS, householdPercentLabel } from '../../share-display';
import { ToastService } from '../../toast/toast.service';
import { TransactionsStore } from '../../stores/transactions.store';
import { Page } from '../../page/page';
import { OfflineDisabled } from '../../offline/offline-disabled';
import { Offline, saveFailureMessage } from '../../offline/offline.service';

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

/** Said next to Andel: where the effective share comes from. */
const SHARE_SOURCES: Record<TransactionDetails['share']['source'], string> = {
  default: 'Standard',
  subcategory: 'Från underkategorin',
  account: 'Från kontot',
  transaction: 'Egen andel',
  purchase: 'Följer köpet',
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
  imports: [
    OfflineDisabled,
    Page,
    RouterLink,
    MoneyPipe,
    TransactionCategoryBadge,
    CategoryTiles,
    ManualTransactionSheet,
    ShareControl,
    Callout,
    Disclosure,
    Icon,
    Skeleton,
    Confirm,
    Menu,
    MenuItem,
    Sheet,
    ShortDatePipe,
  ],
  template: `
    <app-page
      [fetchedAt]="fetchedAt()"
      [title]="state().status === 'gone' ? 'Transaktionen finns inte längre' : undefined"
    >
      <button page-back type="button" data-back class="btn btn-ghost btn-sm" (click)="back()">
        ← Transaktioner
      </button>
      @switch (state().status) {
        @case ('loading') {
          <div aria-busy="true" class="flex flex-col gap-5">
            <app-skeleton shape="card" />
            <app-skeleton shape="card" />
          </div>
        }
        @case ('gone') {
          <a routerLink="/transaktioner" class="font-medium text-accent">Till transaktionerna →</a>
        }
        @case ('failed') {
          <app-callout variant="danger"
            >Transaktionen kunde inte hämtas. Försök igen senare.</app-callout
          >
          <a routerLink="/transaktioner" class="font-medium text-accent">Till transaktionerna →</a>
        }
        @default {
          @if (details(); as t) {
            @let pending = t.status === 'pending';
            <div class="stagger grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
              <div class="flex min-w-0 flex-col gap-5">
                <section data-summary class="card flex flex-col gap-5 p-5 sm:p-6">
                  <div class="flex items-start gap-4">
                    <app-transaction-category-badge
                      class="shrink-0"
                      [category]="t.category"
                      [pending]="pending"
                      [size]="60"
                    />
                    <h1 data-description class="page-title min-w-0 flex-1 [overflow-wrap:anywhere]">
                      {{ t.description || 'Transaktion' }}
                    </h1>
                    @if (t.account === null) {
                      <app-menu data-manual-actions label="Åtgärder för transaktionen">
                        <a
                          appMenuItem
                          appOfflineDisabled
                          data-edit
                          [routerLink]="['/transaktioner', t.id, 'redigera']"
                          >Redigera</a
                        >
                        <button
                          appMenuItem
                          type="button"
                          data-delete
                          appOfflineDisabled
                          [danger]="true"
                          (click)="confirmingDelete.set(true)"
                        >
                          Ta bort…
                        </button>
                      </app-menu>
                    }
                  </div>
                  <p
                    data-amount
                    class="amount text-4xl [overflow-wrap:anywhere] sm:text-[44px] sm:leading-tight"
                    [class.text-positive]="t.amount.amount > 0 && !pending"
                    [class.text-pending]="pending"
                  >
                    {{ t.amount.amount | money: t.amount.currency }}
                  </p>
                  <div data-pills class="flex flex-wrap gap-2">
                    <span
                      data-status-pill
                      class="pill"
                      [class.pill-neutral]="!pending"
                      [class.pill-pending]="pending"
                      >{{ pending ? 'Reserverad' : 'Bokförd' }}</span
                    >
                    @if (sharedLabel(); as label) {
                      <span data-share-pill class="pill pill-neutral">Delad · {{ label }}</span>
                    }
                    @if (t.account === null) {
                      <span data-manual-pill class="pill pill-accent">{{ manualLabel }}</span>
                    }
                  </div>
                  @if (pending) {
                    <p
                      data-pending-note
                      class="rounded-xl border border-pending/30 bg-pending/10 px-4 py-3 text-sm text-pending"
                    >
                      Reserverad – banken har inte bokfört köpet än. Beloppet kan ändras.
                    </p>
                  }
                  <dl
                    class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 border-t border-line pt-5 text-[15px]"
                  >
                    @for (field of fields(); track field.key) {
                      <dt class="text-muted">{{ field.label }}</dt>
                      <dd [attr.data-field]="field.key" class="text-right [overflow-wrap:anywhere]">
                        {{ field.value }}
                      </dd>
                    }
                  </dl>
                  @if (deleteError()) {
                    <app-callout variant="danger"
                      >Transaktionen kunde inte tas bort. Försök igen.</app-callout
                    >
                  }
                </section>
              </div>

              <div class="flex min-w-0 flex-col gap-5">
                <section data-category class="card flex flex-col gap-4 p-4 sm:p-5">
                  <h2 class="card-title">Kategori</h2>
                  <div class="flex items-center gap-3">
                    <app-transaction-category-badge
                      [category]="t.category"
                      [pending]="pending"
                      [size]="40"
                    />
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span
                        data-category-name
                        class="font-medium [overflow-wrap:anywhere]"
                        [class.text-muted]="t.category?.confirmed === false"
                      >
                        @if (t.category; as c) {
                          {{ c.category.name }} / {{ c.subcategory.name }}
                        } @else {
                          Okategoriserad
                        }
                      </span>
                    </span>
                    @if (t.category?.confirmed === false) {
                      <span data-category-guessed-note class="pill pill-guess">Gissad</span>
                    }
                    @if (t.offsets === null) {
                      <button
                        type="button"
                        data-category-button
                        class="btn btn-secondary btn-sm"
                        [attr.aria-expanded]="picking()"
                        [appOfflineDisabled]="saving()"
                        (click)="togglePicker()"
                      >
                        {{ picking() ? 'Stäng' : 'Ändra' }}
                      </button>
                    }
                  </div>
                  @if (t.category; as c) {
                    @if (!c.confirmed && t.offsets === null) {
                      <div
                        data-guess-bar
                        class="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3"
                      >
                        <span class="text-sm font-medium text-warning">Stämmer gissningen?</span>
                        <button
                          type="button"
                          data-confirm-category
                          class="btn btn-positive btn-sm"
                          [appOfflineDisabled]="saving()"
                          (click)="setCategory(c.subcategory.id, 'Kategorin bekräftades')"
                        >
                          Stämmer
                        </button>
                      </div>
                    }
                    @if (t.offsets === null) {
                      <button
                        type="button"
                        data-remove-category
                        class="btn btn-ghost btn-sm self-start"
                        [appOfflineDisabled]="saving()"
                        (click)="setCategory(null, 'Kategorin togs bort')"
                      >
                        Ta bort kategori
                      </button>
                    }
                  }
                  @if (t.offsets !== null) {
                    <p class="text-sm text-muted">Följer köpets kategori.</p>
                  }
                  @if (categoryError(); as error) {
                    <app-callout variant="danger">{{ error }}</app-callout>
                  }
                  @if (similarNote(); as note) {
                    <p data-similar-updated aria-live="polite" class="text-sm text-muted">
                      {{ note }}
                    </p>
                  }
                  @if (picking()) {
                    @if (categories(); as list) {
                      <app-category-tiles
                        [categories]="list"
                        [current]="t.category?.subcategory?.id ?? null"
                        (picked)="setCategory($event, 'Kategorin sparades')"
                      />
                    } @else {
                      <div aria-busy="true"><app-skeleton shape="card" /></div>
                    }
                  }
                </section>

                <section data-share class="card flex flex-col gap-4 p-4 sm:p-5">
                  <div class="flex items-baseline justify-between gap-3">
                    <h2 class="card-title">Andel</h2>
                    <span data-share-source class="text-sm text-muted">{{ shareSource() }}</span>
                  </div>
                  <span data-share-name class="sr-only">{{ shareName() }}</span>
                  @if (t.offsets; as purchase) {
                    <a
                      data-share-purchase
                      [routerLink]="['/transaktioner', purchase.id]"
                      class="text-sm font-medium text-accent [overflow-wrap:anywhere]"
                    >
                      {{ purchase.description }} →
                    </a>
                  } @else {
                    <app-share-control
                      [value]="t.share.option"
                      [disabled]="saving()"
                      [fullWidth]="true"
                      [householdDisabled]="ratio() !== null && ratio()!.length === 0"
                      (changed)="setShare($event)"
                    />
                  }
                  <div
                    class="flex h-2 overflow-hidden rounded-full bg-surface-3"
                    role="presentation"
                  >
                    <div
                      data-share-bar
                      class="bar-grow h-full bg-accent transition-[width] duration-500"
                      [style.width.%]="t.share.percent"
                    ></div>
                  </div>
                  <div class="flex justify-between gap-3 text-sm">
                    <span class="flex flex-col">
                      <span class="text-muted">Din del</span>
                      <span data-share-part class="amount">{{
                        ownerPart() | money: t.amount.currency
                      }}</span>
                    </span>
                    <span class="flex flex-col items-end">
                      <span class="text-muted">Partnerns del</span>
                      <span data-share-partner-part class="amount">{{
                        partnerPart() | money: t.amount.currency
                      }}</span>
                    </span>
                  </div>
                  @if (t.offsets === null && t.share.source === 'transaction') {
                    <button
                      type="button"
                      data-remove-share
                      class="btn btn-ghost btn-sm self-start"
                      [appOfflineDisabled]="saving()"
                      (click)="setShare(null)"
                    >
                      Ta bort egen andel
                    </button>
                  }
                  @if (shareError(); as error) {
                    <app-callout data-share-error variant="danger">{{ error }}</app-callout>
                  }
                </section>

                @if (t.offsets; as purchase) {
                  <section data-offsets class="card flex flex-col gap-3 p-4 sm:p-5">
                    <h2 class="card-title">Kvittad mot</h2>
                    <a
                      data-offsets-purchase
                      [routerLink]="['/transaktioner', purchase.id]"
                      class="tx-row flex justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5"
                    >
                      <span class="flex min-w-0 flex-col">
                        <span class="font-medium [overflow-wrap:anywhere]">{{
                          purchase.description
                        }}</span>
                        <span class="text-sm text-muted">{{ purchase.date | shortDate }}</span>
                      </span>
                      <span class="amount shrink-0">{{
                        purchase.amount.amount | money: purchase.amount.currency
                      }}</span>
                    </a>
                    <p class="text-sm text-muted">
                      Räknas i köpets månad och följer köpets kategori.
                    </p>
                    <button
                      type="button"
                      data-remove-offset
                      class="btn btn-secondary btn-sm self-start"
                      [appOfflineDisabled]="saving()"
                      (click)="setOffset(null)"
                    >
                      Ta bort kvittning
                    </button>
                  </section>
                } @else if (t.amount.amount > 0 && t.status === 'booked') {
                  <section data-offset-picker class="card flex flex-col gap-3 p-4 sm:p-5">
                    <h2 class="card-title">Återbetalning?</h2>
                    <button
                      type="button"
                      data-offset-toggle
                      appOfflineDisabled
                      class="btn btn-secondary btn-sm self-start"
                      aria-haspopup="dialog"
                      (click)="toggleOffset()"
                    >
                      Kvitta mot ett köp
                    </button>
                  </section>
                }

                @if (t.refunds.length > 0 && t.netAmount; as net) {
                  <section data-refunds class="card flex flex-col gap-3 p-4 sm:p-5">
                    <h2 class="card-title">Kvitterat av</h2>
                    <ul class="flex flex-col gap-1">
                      @for (refund of t.refunds; track refund.id) {
                        <li>
                          <a
                            [attr.data-refund]="refund.id"
                            [routerLink]="['/transaktioner', refund.id]"
                            class="tx-row flex justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5"
                          >
                            <span class="flex min-w-0 flex-col">
                              <span class="font-medium [overflow-wrap:anywhere]">{{
                                refund.description
                              }}</span>
                              <span class="text-sm text-muted">{{ refund.date | shortDate }}</span>
                            </span>
                            <span class="amount text-positive shrink-0">{{
                              refund.amount.amount | money: refund.amount.currency
                            }}</span>
                          </a>
                        </li>
                      }
                    </ul>
                    <p class="flex justify-between border-t border-line pt-3 font-medium">
                      <span>Netto</span>
                      <span data-net-amount class="amount">{{
                        net.amount | money: net.currency
                      }}</span>
                    </p>
                  </section>
                }
              </div>
            </div>
            @if (t.account !== null) {
              <div class="card p-4 sm:p-5">
                <app-disclosure data-raw label="Rådata" [title]="true">
                  <pre data-raw-json class="overflow-x-auto text-sm select-all">{{
                    rawJson()
                  }}</pre>
                </app-disclosure>
              </div>
            }
          }
        }
      }
    </app-page>

    @if (confirmingDelete() && details(); as t) {
      <app-confirm
        heading="Ta bort transaktionen?"
        message="Transaktionen tas bort för gott."
        confirmLabel="Ta bort"
        [busy]="saving()"
        (confirmed)="deleteManual(t.id)"
        (cancelled)="confirmingDelete.set(false)"
      />
    }

    @if (offsetting()) {
      <app-sheet heading="Kvitta mot ett köp" (closed)="offsetting.set(false)">
        <label class="field">
          <app-icon class="field-icon" name="search" [size]="20" />
          <input
            data-offset-search
            data-autofocus
            type="search"
            placeholder="Sök köp"
            aria-label="Sök köp"
            class="field-control"
            [value]="offsetSearch()"
            (input)="searchOffsets($any($event.target).value)"
          />
          @if (offsetSearch() !== '') {
            <button
              type="button"
              data-clear-offset-search
              aria-label="Rensa sökning"
              class="field-icon"
              (click)="searchOffsets('')"
            >
              <app-icon name="x" />
            </button>
          }
        </label>
        @if (offsetCandidates(); as candidates) {
          @if (candidates.length === 0) {
            <p data-offset-empty class="text-sm text-muted">
              {{ offsetSearch().trim() ? 'Inga träffar' : 'Inga troliga köp. Sök efter ett.' }}
            </p>
          }
          <ul class="flex flex-col gap-1">
            @for (candidate of candidates; track candidate.id) {
              <li>
                <button
                  type="button"
                  [attr.data-offset-candidate]="candidate.id"
                  class="tx-row flex w-full justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-left"
                  [appOfflineDisabled]="saving()"
                  (click)="setOffset(candidate.id)"
                >
                  <span class="flex min-w-0 flex-col [overflow-wrap:anywhere]">
                    <span class="font-medium">{{ candidate.description }}</span>
                    <span class="text-sm text-muted">{{ candidate.date | shortDate }}</span>
                  </span>
                  <span class="amount shrink-0">{{
                    candidate.amount.amount | money: candidate.amount.currency
                  }}</span>
                </button>
              </li>
            }
          </ul>
        } @else {
          <div aria-busy="true"><app-skeleton [count]="3" /></div>
        }
      </app-sheet>
    }

    @if (editing()) {
      <app-manual-transaction-sheet
        [transactionId]="id()"
        (saved)="onEdited()"
        (closed)="closeEditor()"
      />
    }
  `,
})
export class TransactionDetailsPage {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly transactionsStore = inject(TransactionsStore);
  private readonly categoryList = inject(CategoriesService);
  private readonly sharesStore = inject(SharesStore);
  private readonly toast = inject(ToastService);
  private readonly offline = inject(Offline);
  private readonly route = inject(ActivatedRoute);

  /** The id in the URL; `/transaktioner/:id/redigera` opens the edit form over the page. */
  protected readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: null,
  });
  protected readonly editing = toSignal(
    this.route.url.pipe(map((segments) => segments.at(-1)?.path === 'redigera')),
    { initialValue: false },
  );

  protected readonly confirmingDelete = signal(false);
  protected readonly deleteError = signal(false);
  protected readonly picking = signal(false);
  protected readonly saving = signal(false);
  protected readonly categoryError = signal<string | null>(null);
  protected readonly similarNote = signal<string | null>(null);
  /** Fetched the first time the picker opens. */
  protected readonly categories = signal<Category[] | null>(null);
  private loadingCategories = false;

  protected readonly shareError = signal<string | null>(null);
  protected readonly manualLabel = MANUAL_LABEL;
  /** The household ratio; null until it is fetched or if that failed. */
  protected readonly ratio = computed(() => this.sharesStore.householdRatio() ?? null);
  private shareRequest: Subscription | undefined;

  protected readonly offsetting = signal(false);
  protected readonly offsetSearch = signal('');
  /** Null while the candidates are being fetched. */
  protected readonly offsetCandidates = signal<Transaction[] | null>(null);
  private candidateRequest: Subscription | undefined;

  private readonly read = this.transactionsStore.details(computed(() => this.id() ?? undefined));
  /** When the device fetched what the page shows; the page says so while offline. */
  protected readonly fetchedAt = computed(() => [
    this.read.fetchedAt(),
    this.sharesStore.fetchedAt(),
  ]);
  /**
   * What a change answered with, shown until the read has fetched again. It is dropped when the
   * read's value changes, which includes moving to another transaction.
   */
  private readonly edited = linkedSignal<TransactionDetails | undefined, TransactionDetails | null>(
    {
      source: this.read.value,
      computation: () => null,
    },
  );
  protected readonly state = computed<State>(() => {
    const details = this.edited() ?? this.read.value();
    if (details !== undefined && details !== null) return { status: 'ready', details };
    if (!this.read.failed()) return { status: 'loading' };
    const error = this.read.error();
    return {
      status: error instanceof HttpErrorResponse && error.status === 404 ? 'gone' : 'failed',
    };
  });
  protected readonly details = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? state.details : null;
  });

  /** The fields shown above the dates, left out when the bank did not send them. */
  protected readonly fields = computed<Field[]>(() => {
    const t = this.details();
    if (t === null) return [];
    const fields: Field[] = [];
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
    if (t.account !== null) fields.push({ label: 'Bank', key: 'bank', value: t.account.bank });
    fields.push({
      label: 'Konto',
      key: 'account',
      value:
        t.account === null ? MANUAL_LABEL : `${t.account.name} (${ACCOUNT_TYPES[t.account.type]})`,
    });
    fields.push({
      label: 'Betald av',
      key: 'paidBy',
      value: t.paidBy === 'partner' ? 'Partner' : 'Jag',
    });
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
    this.sharesStore.activate();
    inject(DestroyRef).onDestroy(() => this.sharesStore.deactivate());
    // A picker left open when the app goes offline closes: a change cannot be made from it.
    effect(() => {
      if (this.offline.isOffline()) untracked(() => this.picking.set(false));
    });
    // Following a link to the linked purchase or refund keeps this page and changes the id.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => this.reset());
  }

  protected closeEditor(): void {
    void this.router.navigate(['/transaktioner', this.id()]);
  }

  /** The edit is a `transactions` fact, so the read fetches the details again itself. */
  protected onEdited(): void {
    this.toast.show('Transaktionen sparades');
    this.closeEditor();
  }

  /** Forgets what belonged to the transaction shown before. */
  private reset(): void {
    this.candidateRequest?.unsubscribe();
    this.shareRequest?.unsubscribe();
    this.saving.set(false);
    this.offsetting.set(false);
    this.offsetCandidates.set(null);
    this.categoryError.set(null);
    this.similarNote.set(null);
    this.picking.set(false);
    this.shareError.set(null);
  }

  /** The effective share, named the way the options are: Hushåll shows its ratio. */
  protected readonly shareName = computed(() => {
    const share = this.details()?.share;
    if (share === undefined) return '';
    return share.option === 'household'
      ? householdPercentLabel(share.percent)
      : SHARE_LABELS[share.option];
  });

  protected readonly shareSource = computed(() => {
    const t = this.details();
    return t === null ? '' : SHARE_SOURCES[t.share.source];
  });

  /** The share named in the *Delad* pill; null while the transaction is the owner's alone. */
  protected readonly sharedLabel = computed(() => {
    const share = this.details()?.share;
    if (share === undefined || share.option === 'me') return null;
    return SHARE_LABELS[share.option];
  });

  /** The owner's part of the amount, signed like the amount. */
  protected readonly ownerPart = computed(() => {
    const t = this.details();
    return t?.ownerPart ?? 0;
  });

  /** What the partner bears of the amount, signed like the amount. */
  protected readonly partnerPart = computed(() => {
    const t = this.details();
    return t === null ? 0 : Math.round((t.amount.amount - this.ownerPart()) * 100) / 100 + 0;
  });

  /** Sets the transaction's own share; null removes it so the inherited share applies. */
  protected setShare(share: ShareOption | null): void {
    const details = this.details();
    if (details === null || this.saving()) return;
    this.saving.set(true);
    this.shareError.set(null);
    this.shareRequest = this.transactionsStore.setShare(details.id, share).subscribe({
      next: (updated) => {
        this.edited.set(updated);
        this.toast.show(share === null ? 'Egen andel togs bort' : 'Andelen sparades');
        this.saving.set(false);
      },
      error: (error: unknown) => {
        this.shareError.set(saveFailureMessage(error, 'Andelen kunde inte sparas. Försök igen.'));
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
    this.candidateRequest = this.transactionsStore.offsetCandidates(details.id, text).subscribe({
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
    this.transactionsStore.setOffset(details.id, purchaseId).subscribe({
      next: (updated) => {
        this.edited.set(updated);
        this.toast.show(purchaseId === null ? 'Kvittningen togs bort' : 'Kvittningen sparades');
        this.offsetting.set(false);
        this.saving.set(false);
      },
      error: (error: unknown) => {
        this.categoryError.set(
          saveFailureMessage(error, 'Kvittningen kunde inte sparas. Försök igen.'),
        );
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
  protected setCategory(subcategoryId: number | null, saved: string): void {
    const details = this.details();
    if (details === null || this.saving()) return;
    this.saving.set(true);
    this.categoryError.set(null);
    this.similarNote.set(null);
    this.transactionsStore.setCategory(details.id, subcategoryId).subscribe({
      next: ({ category, updatedSimilar }) => {
        this.edited.set({ ...details, category });
        this.similarNote.set(similarUpdatedNote(updatedSimilar));
        this.toast.show(saved);
        this.picking.set(false);
        this.saving.set(false);
      },
      error: (error: unknown) => {
        this.categoryError.set(
          saveFailureMessage(error, 'Kategorin kunde inte sparas. Försök igen.'),
        );
        this.saving.set(false);
      },
    });
  }

  /** Deletes a manual transaction and returns to the list. */
  protected deleteManual(id: number): void {
    this.saving.set(true);
    this.deleteError.set(false);
    this.transactionsStore.deleteManual(id).subscribe({
      next: () => {
        this.toast.show('Transaktionen togs bort');
        void this.router.navigateByUrl('/transaktioner');
      },
      error: () => {
        this.deleteError.set(true);
        this.confirmingDelete.set(false);
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
