import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  ElementRef,
  DestroyRef,
  type OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type {
  Category,
  ManualTransactionRequest,
  PaidBy,
  ShareOption,
  Transaction,
} from '@bankapp/shared';
import { catchError, of } from 'rxjs';
import { formatAmountInput, parseAmount } from '../formatting/amount';
import { CategoriesService } from '../categories.service';
import { CategoryTiles } from '../category-tiles/category-tiles';
import { today } from '../dates';
import { lockPageScroll } from '../scroll-lock';
import { SHARE_LABELS, SHARE_OPTION_ORDER } from '../share-display';
import { SharesService } from '../shares.service';
import { TransactionsService } from '../transactions.service';

type Status = 'loading' | 'ready' | 'failed' | 'gone';

const INCOMPLETE = 'Fyll i belopp, beskrivning och underkategori.';

const SHARE_CHOICES: { value: ShareOption; label: string }[] = SHARE_OPTION_ORDER.map((value) => ({
  value,
  label: SHARE_LABELS[value],
}));

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The form for adding a manual transaction, or editing one when `transactionId` is set (ADR 0009).
 * It opens over the page that hosts it: a centred modal on desktop, a bottom sheet on mobile.
 */
@Component({
  selector: 'app-manual-transaction-sheet',
  imports: [CategoryTiles],
  host: { '(document:keydown.escape)': 'dismiss()' },
  template: `
    <button
      type="button"
      data-backdrop
      tabindex="-1"
      aria-hidden="true"
      [class.sheet-backdrop]="!entered()"
      class="fixed inset-0 z-50 cursor-default bg-black/70"
      (click)="dismiss()"
    ></button>
    <div
      #dialog
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="transactionId() === null ? 'Ny transaktion' : 'Redigera transaktion'"
      data-sheet
      [class.modal-sheet]="!entered()"
      (animationend)="$event.target === $event.currentTarget && entered.set(true)"
      class="bg-surface-1 border-line-strong fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-36px)] flex-col rounded-t-3xl border sm:inset-x-0 sm:top-6 sm:bottom-auto sm:mx-auto sm:max-h-[calc(100dvh-3rem)] sm:w-[600px] sm:max-w-[calc(100vw-2rem)] sm:rounded-3xl"
      (keydown)="trapFocus($event)"
    >
      <header class="flex items-center justify-between px-5 pt-4 pb-2">
        <h2 data-title class="text-lg font-semibold">
          {{ transactionId() === null ? 'Ny transaktion' : 'Redigera transaktion' }}
        </h2>
        <button
          type="button"
          data-close
          aria-label="Stäng"
          class="btn btn-ghost"
          (click)="dismiss()"
        >
          ✕
        </button>
      </header>

      @switch (status()) {
        @case ('loading') {
          <p class="px-5 py-8" aria-live="polite">Hämtar…</p>
        }
        @case ('failed') {
          <p class="px-5 py-8" role="alert">Transaktionen kunde inte hämtas. Försök igen senare.</p>
        }
        @case ('gone') {
          <p class="px-5 py-8">Transaktionen finns inte längre, eller går inte att redigera.</p>
        }
        @default {
          <form
            data-form
            class="flex min-h-0 flex-1 flex-col"
            (submit)="$event.preventDefault(); save()"
          >
            <div
              class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 py-3"
            >
              <div class="segmented self-start" role="group" aria-label="Typ">
                <button
                  type="button"
                  data-kind="out"
                  [attr.aria-pressed]="direction() === 'out'"
                  (click)="setDirection('out')"
                >
                  Utgift
                </button>
                <button
                  type="button"
                  data-kind="in"
                  [attr.aria-pressed]="direction() === 'in'"
                  (click)="setDirection('in')"
                >
                  Inkomst
                </button>
              </div>

              <label class="flex flex-col gap-1 text-sm text-muted">
                Belopp
                <span class="field justify-center gap-2" style="height: 76px">
                  <span class="amount text-[44px] leading-none text-muted" aria-hidden="true">{{
                    direction() === 'out' ? '−' : '+'
                  }}</span>
                  <input
                    #amountInput
                    data-amount
                    type="text"
                    inputmode="decimal"
                    placeholder="0"
                    class="field-control amount !flex-none text-center text-[44px] text-ink"
                    style="width: 9ch; field-sizing: content; min-width: 2ch"
                    [value]="amount()"
                    (input)="amount.set(value($event))"
                  />
                  <span class="field-suffix text-xl">kr</span>
                </span>
              </label>

              <div class="grid gap-3 sm:grid-cols-2">
                <label class="flex flex-col gap-1 text-sm text-muted">
                  Beskrivning
                  <input
                    data-description
                    type="text"
                    class="input"
                    autocomplete="off"
                    [value]="description()"
                    (input)="description.set(value($event))"
                  />
                </label>
                <label class="flex flex-col gap-1 text-sm text-muted">
                  Datum
                  <span class="field">
                    <svg
                      class="field-icon"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M3 10h18M8 3v4M16 3v4" />
                    </svg>
                    <input
                      data-date
                      type="date"
                      class="field-control"
                      [value]="date()"
                      (input)="date.set(value($event))"
                    />
                  </span>
                </label>
              </div>

              <section class="flex flex-col gap-2" aria-label="Kategori">
                <h3 class="text-sm text-muted">Kategori</h3>
                <app-category-tiles
                  [categories]="shownCategories()"
                  [current]="subcategoryId()"
                  (picked)="subcategoryId.set($event)"
                />
              </section>

              <section class="flex flex-col gap-2">
                <h3 class="text-sm text-muted">Andel</h3>
                <div class="segmented self-start" role="group" aria-label="Andel">
                  @for (choice of shareChoices; track choice.value) {
                    <button
                      type="button"
                      [attr.data-share]="choice.value"
                      [attr.aria-pressed]="shownShare() === choice.value"
                      (click)="share.set(choice.value)"
                    >
                      {{ choice.label }}
                    </button>
                  }
                </div>
              </section>

              <section class="flex flex-col gap-2">
                <h3 class="text-sm text-muted">Betald av</h3>
                <div class="segmented self-start" role="group" aria-label="Betald av">
                  <button
                    type="button"
                    data-paid-by="owner"
                    [attr.aria-pressed]="paidBy() === 'owner'"
                    (click)="paidBy.set('owner')"
                  >
                    Jag
                  </button>
                  <button
                    type="button"
                    data-paid-by="partner"
                    [attr.aria-pressed]="paidBy() === 'partner'"
                    (click)="paidBy.set('partner')"
                  >
                    Partner
                  </button>
                </div>
              </section>

              @if (error(); as message) {
                <p role="alert" class="text-danger text-sm">{{ message }}</p>
              }
            </div>

            <footer class="border-line flex gap-3 border-t px-5 py-4">
              <button type="button" data-cancel class="btn btn-ghost" (click)="dismiss()">
                Avbryt
              </button>
              <button
                type="submit"
                data-save
                class="btn btn-primary flex-1"
                [disabled]="saving() || !amountValid()"
              >
                Spara transaktion
              </button>
            </footer>
          </form>
        }
      }
    </div>
  `,
})
export class ManualTransactionSheet implements OnInit {
  /** The manual transaction to edit, or null to add a new one. */
  readonly transactionId = input<string | null>(null);
  /** The transaction after it was saved. */
  readonly saved = output<Transaction>();
  /** The owner dismissed the sheet (Escape, backdrop, Avbryt or the close button). */
  readonly closed = output<void>();

  private readonly transactions = inject(TransactionsService);
  private readonly categoryService = inject(CategoriesService);
  private readonly shares = inject(SharesService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  protected readonly shareChoices = SHARE_CHOICES;
  protected readonly entered = signal(false);
  protected readonly status = signal<Status>('loading');
  private readonly categories = signal<Category[]>([]);
  /** The share each subcategory with a share other than Jag has. */
  private readonly subcategoryShares = signal<Map<number, ShareOption>>(new Map());
  private editingId: number | null = null;

  protected readonly description = signal('');
  protected readonly direction = signal<'out' | 'in'>('out');
  protected readonly amount = signal('');
  /** An empty amount is allowed until the owner saves; text that is not a number is not (zero is caught on save). */
  protected readonly amountValid = computed(() => {
    const text = this.amount().trim();
    return text === '' || parseAmount(text) !== null;
  });
  protected readonly date = signal(today());
  protected readonly subcategoryId = signal<number | null>(null);
  /** The share the owner chose; null leaves it to the subcategory. */
  protected readonly share = signal<ShareOption | null>(null);
  protected readonly paidBy = signal<PaidBy>('owner');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly shownCategories = computed(() =>
    this.categories().filter((c) => c.kind === (this.direction() === 'out' ? 'expense' : 'income')),
  );

  /** The share chosen, else the one the subcategory has. */
  protected readonly shownShare = computed<ShareOption>(() => {
    const own = this.share();
    if (own !== null) return own;
    const id = this.subcategoryId();
    return (id === null ? undefined : this.subcategoryShares().get(id)) ?? 'me';
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly opener = document.activeElement;

  constructor() {
    lockPageScroll();
    inject(DestroyRef).onDestroy(() => {
      if (this.opener instanceof HTMLElement && this.opener.isConnected) this.opener.focus();
    });
    // Focus moves into the sheet once the form is there.
    effect(() => {
      const target = this.amountInput() ?? this.dialog();
      target?.nativeElement.focus();
    });
  }

  /** Inputs are set once the component exists, so what to load is decided here. */
  ngOnInit(): void {
    // The sheet is positioned against the window, so it must not sit inside the routed page:
    // that page is animated, and a fixed element inside it moves with the page's scroll.
    document.body.append(this.host);
    this.shares
      .subcategoryShares()
      .pipe(catchError(() => of([])))
      .subscribe((shares) =>
        this.subcategoryShares.set(new Map(shares.map((s) => [s.subcategoryId, s.share]))),
      );
    this.categoryService.list().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        const id = this.transactionId();
        if (id === null) this.status.set('ready');
        else this.load(id);
      },
      error: () => this.status.set('failed'),
    });
  }

  private load(id: string): void {
    this.transactions.get(id).subscribe({
      next: (t) => {
        if (t.account !== null) return this.status.set('gone');
        this.editingId = t.id;
        this.description.set(t.description);
        this.direction.set(t.amount.amount < 0 ? 'out' : 'in');
        this.amount.set(formatAmountInput(Math.abs(t.amount.amount)));
        this.date.set(t.transactionDate ?? today());
        this.subcategoryId.set(t.category === null ? null : t.category.subcategory.id);
        this.share.set(t.share.source === 'transaction' ? t.share.option : null);
        this.paidBy.set(t.paidBy);
        this.status.set('ready');
      },
      error: (error: unknown) =>
        this.status.set(
          error instanceof HttpErrorResponse && error.status === 404 ? 'gone' : 'failed',
        ),
    });
  }

  /** Closes the sheet, except while the transaction is being saved. */
  protected dismiss(): void {
    if (!this.saving()) this.closed.emit();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setDirection(direction: 'out' | 'in'): void {
    if (direction === this.direction()) return;
    this.direction.set(direction);
    // The subcategory belongs to the other kind of category now.
    this.subcategoryId.set(null);
  }

  /** Keeps Tab and Shift+Tab inside the sheet. */
  protected trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      this.dialog()?.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    );
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected save(): void {
    if (this.saving()) return;
    const parsed = parseAmount(this.amount());
    const size = parsed === null ? 0 : Math.round(parsed * 100) / 100;
    const subcategoryId = this.subcategoryId();
    if (!(size > 0) || this.description().trim() === '' || subcategoryId === null) {
      this.error.set(INCOMPLETE);
      return;
    }
    const request: ManualTransactionRequest = {
      description: this.description().trim(),
      amount: this.direction() === 'out' ? -size : size,
      subcategoryId,
      date: this.date() === '' ? today() : this.date(),
      share: this.share(),
      paidBy: this.paidBy(),
    };
    const id = this.editingId;
    this.saving.set(true);
    this.error.set(null);
    (id === null
      ? this.transactions.addManual(request)
      : this.transactions.editManual(id, request)
    ).subscribe({
      next: (saved) => this.saved.emit(saved),
      error: (error: unknown) => {
        this.error.set(
          error instanceof HttpErrorResponse && error.status === 409
            ? 'Ställ in ett hushållsförhållande innan du väljer Hushåll.'
            : 'Transaktionen kunde inte sparas. Försök igen.',
        );
        this.saving.set(false);
      },
    });
  }
}
