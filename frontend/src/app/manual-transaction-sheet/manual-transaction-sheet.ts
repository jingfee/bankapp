import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  type ElementRef,
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
import { formatAmountInput, parseAmount } from '../formatting/amount';
import { CategoriesService } from '../categories.service';
import { Callout } from '../callout/callout';
import { Sheet } from '../sheet/sheet';
import { Skeleton } from '../skeleton/skeleton';
import { CategoryTiles } from '../category-tiles/category-tiles';
import { DateField } from '../date-field/date-field';
import { today } from '../dates';
import { OfflineDisabled } from '../offline/offline-disabled';
import { saveFailureMessage } from '../offline/offline.service';
import { ShareControl } from '../share-control/share-control';
import { SharesStore } from '../stores/shares.store';
import { TransactionsStore } from '../stores/transactions.store';

type Status = 'loading' | 'ready' | 'failed' | 'gone';

const INCOMPLETE = 'Fyll i belopp, beskrivning och underkategori.';

/**
 * The form for adding a manual transaction, or editing one when `transactionId` is set (ADR 0009).
 * It opens in a Sheet over the page that hosts it.
 */
@Component({
  selector: 'app-manual-transaction-sheet',
  imports: [CategoryTiles, DateField, ShareControl, Callout, Sheet, Skeleton, OfflineDisabled],
  template: `
    <app-sheet
      [heading]="transactionId() === null ? 'Ny transaktion' : 'Redigera transaktion'"
      [dismissible]="!saving()"
      (closed)="closed.emit()"
      (submitted)="save()"
    >
      @switch (status()) {
        @case ('loading') {
          <div class="py-5" aria-busy="true"><app-skeleton [count]="3" /></div>
        }
        @case ('failed') {
          <app-callout variant="danger"
            >Transaktionen kunde inte hämtas. Försök igen senare.</app-callout
          >
        }
        @case ('gone') {
          <p class="py-5">Transaktionen finns inte längre, eller går inte att redigera.</p>
        }
        @default {
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
              <span class="field"
                ><input
                  data-description
                  type="text"
                  class="field-control"
                  autocomplete="off"
                  [value]="description()"
                  (input)="description.set(value($event))"
              /></span>
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
                <app-date-field
                  data-date
                  class="min-w-0 flex-1"
                  fieldClass="field-control text-left"
                  [value]="date()"
                  (valueChange)="date.set($event)"
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
            <app-share-control label="Andel" [value]="shownShare()" (changed)="share.set($event)" />
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
            <app-callout variant="danger">{{ message }}</app-callout>
          }
        }
      }
      <ng-container sheet-footer>
        @if (status() === 'ready') {
          <button type="button" data-cancel class="btn btn-ghost" (click)="dismiss()">
            Avbryt
          </button>
          <button
            type="submit"
            data-save
            class="btn btn-primary flex-1"
            [appOfflineDisabled]="saving() || !amountValid()"
          >
            Spara transaktion
          </button>
        }
      </ng-container>
    </app-sheet>
  `,
})
export class ManualTransactionSheet implements OnInit {
  /** The manual transaction to edit, or null to add a new one. */
  readonly transactionId = input<string | null>(null);
  /** The transaction after it was saved. */
  readonly saved = output<Transaction>();
  /** The owner dismissed the sheet (Escape, backdrop, Avbryt or the close button). */
  readonly closed = output<void>();

  private readonly transactionsStore = inject(TransactionsStore);
  private readonly categoryService = inject(CategoriesService);
  private readonly sharesStore = inject(SharesStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly amountInput = viewChild<ElementRef<HTMLInputElement>>('amountInput');

  protected readonly status = signal<Status>('loading');
  private readonly categories = signal<Category[]>([]);
  /** The share each subcategory with a share other than Jag has. */
  private readonly subcategoryShares = computed(
    () =>
      new Map((this.sharesStore.subcategoryShares() ?? []).map((s) => [s.subcategoryId, s.share])),
  );
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

  constructor() {
    // Focus moves to the amount once the form is there.
    effect(() => this.amountInput()?.nativeElement.focus());
  }

  /** Inputs are set once the component exists, so what to load is decided here. */
  ngOnInit(): void {
    this.sharesStore.activate();
    this.destroyRef.onDestroy(() => this.sharesStore.deactivate());
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
    this.transactionsStore.get(id).subscribe({
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
      ? this.transactionsStore.addManual(request)
      : this.transactionsStore.editManual(id, request)
    ).subscribe({
      next: (saved) => this.saved.emit(saved),
      error: (error: unknown) => {
        this.error.set(
          error instanceof HttpErrorResponse && error.status === 409
            ? 'Ställ in ett hushållsförhållande innan du väljer Hushåll.'
            : saveFailureMessage(error, 'Transaktionen kunde inte sparas. Försök igen.'),
        );
        this.saving.set(false);
      },
    });
  }
}
