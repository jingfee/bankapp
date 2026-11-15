import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Category, ManualTransactionRequest, ShareOption } from '@bankapp/shared';
import { CategoriesService } from '../../categories.service';
import { TransactionsService } from '../../transactions.service';

type Status = 'loading' | 'ready' | 'failed' | 'gone';

/** Today as `YYYY-MM-DD` in the owner's own time zone. */
function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

const SHARE_CHOICES: { value: ShareOption | ''; label: string }[] = [
  { value: '', label: 'Underkategorins andel' },
  { value: 'me', label: 'Jag' },
  { value: 'half', label: '50/50' },
  { value: 'household', label: 'Hushåll' },
  { value: 'partner', label: 'Partner betalar allt' },
];

/** Adds a manual transaction, or edits one (ADR 0009); the route decides which. */
@Component({
  selector: 'app-manual-transaction-page',
  imports: [RouterLink],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <a routerLink="/transaktioner" class="self-start text-sm underline">← Transaktioner</a>
      @switch (status()) {
        @case ('loading') {
          <p aria-live="polite">Hämtar…</p>
        }
        @case ('failed') {
          <p role="alert">Transaktionen kunde inte hämtas. Försök igen senare.</p>
        }
        @case ('gone') {
          <p>Transaktionen finns inte längre, eller går inte att redigera.</p>
        }
        @default {
          <h1 data-title class="text-3xl font-semibold tracking-tight">
            {{ editingId() === null ? 'Ny transaktion' : 'Redigera transaktion' }}
          </h1>
          <form data-form class="flex flex-col gap-4" (submit)="$event.preventDefault(); save()">
            <label class="flex flex-col text-sm">
              Beskrivning
              <input
                data-description
                type="text"
                class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                [value]="description()"
                (input)="description.set(value($event))"
              />
            </label>
            <div class="flex gap-3">
              <label class="flex flex-col text-sm">
                Typ
                <select
                  data-direction
                  class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                  [value]="direction()"
                  (change)="direction.set(value($event) === 'in' ? 'in' : 'out')"
                >
                  <option value="out">Utgift</option>
                  <option value="in">Inkomst</option>
                </select>
              </label>
              <label class="flex flex-1 flex-col text-sm">
                Belopp (kr)
                <input
                  data-amount
                  type="number"
                  step="0.01"
                  min="0"
                  class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                  [value]="amount()"
                  (input)="amount.set(value($event))"
                />
              </label>
            </div>
            <label class="flex flex-col text-sm">
              Datum
              <input
                data-date
                type="date"
                class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                [value]="date()"
                (input)="date.set(value($event))"
              />
            </label>
            <label class="flex flex-col text-sm">
              Underkategori
              <select
                data-subcategory
                class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                [value]="subcategoryId()"
                (change)="subcategoryId.set(value($event))"
              >
                <option value="">Välj underkategori</option>
                @for (category of categories(); track category.id) {
                  <optgroup [label]="category.name">
                    @for (subcategory of category.subcategories; track subcategory.id) {
                      <option
                        [value]="subcategory.id"
                        [selected]="subcategoryId() === '' + subcategory.id"
                      >
                        {{ subcategory.name }}
                      </option>
                    }
                  </optgroup>
                }
              </select>
            </label>
            <label class="flex flex-col text-sm">
              Andel
              <select
                data-share
                class="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                (change)="share.set($any(value($event)))"
              >
                @for (choice of shareChoices; track choice.value) {
                  <option [value]="choice.value" [selected]="share() === choice.value">
                    {{ choice.label }}
                  </option>
                }
              </select>
            </label>
            @if (error(); as message) {
              <p role="alert" class="text-sm text-red-700 dark:text-red-400">{{ message }}</p>
            }
            <button
              type="submit"
              data-save
              class="self-start rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              [disabled]="saving() || !valid()"
            >
              Spara
            </button>
          </form>
        }
      }
    </main>
  `,
})
export class ManualTransactionPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transactions = inject(TransactionsService);
  private readonly categoryService = inject(CategoriesService);

  protected readonly shareChoices = SHARE_CHOICES;
  protected readonly status = signal<Status>('loading');
  /** The manual transaction being edited, or null when adding a new one. */
  protected readonly editingId = signal<number | null>(null);
  protected readonly categories = signal<Category[]>([]);
  protected readonly description = signal('');
  protected readonly direction = signal<'out' | 'in'>('out');
  protected readonly amount = signal('');
  protected readonly date = signal(today());
  protected readonly subcategoryId = signal('');
  protected readonly share = signal<ShareOption | ''>('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly valid = computed(
    () =>
      this.description().trim() !== '' &&
      Number(this.amount()) > 0 &&
      this.date() !== '' &&
      this.subcategoryId() !== '',
  );

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    this.categoryService.list().subscribe({
      next: (categories) => {
        this.categories.set(categories);
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
        this.editingId.set(t.id);
        this.description.set(t.description);
        this.direction.set(t.amount.amount < 0 ? 'out' : 'in');
        this.amount.set(String(Math.abs(t.amount.amount)));
        this.date.set(t.transactionDate ?? today());
        this.subcategoryId.set(t.category === null ? '' : String(t.category.subcategory.id));
        this.share.set(t.share.source === 'transaction' ? t.share.option : '');
        this.status.set('ready');
      },
      error: (error: unknown) =>
        this.status.set(
          error instanceof HttpErrorResponse && error.status === 404 ? 'gone' : 'failed',
        ),
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected save(): void {
    if (!this.valid() || this.saving()) return;
    const share = this.share();
    const size = Math.round(Number(this.amount()) * 100) / 100;
    const request: ManualTransactionRequest = {
      description: this.description().trim(),
      amount: this.direction() === 'out' ? -size : size,
      subcategoryId: Number(this.subcategoryId()),
      date: this.date(),
      share: share === '' ? null : share,
    };
    const id = this.editingId();
    this.saving.set(true);
    this.error.set(null);
    (id === null
      ? this.transactions.addManual(request)
      : this.transactions.editManual(id, request)
    ).subscribe({
      next: (saved) => void this.router.navigate(['/transaktioner', saved.id]),
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
