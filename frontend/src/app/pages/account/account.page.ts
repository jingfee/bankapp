import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Transaction, TransactionsResponse } from '@bankapp/shared';
import { DateHeadingPipe } from '../../formatting/date-heading.pipe';
import { MoneyPipe } from '../../formatting/money.pipe';
import { TransactionsService } from '../../transactions.service';

type Account = TransactionsResponse['account'];
type Status = 'loading' | 'ready' | 'failed' | 'notFound';

interface DayGroup {
  date: string;
  transactions: Transaction[];
}

@Component({
  selector: 'app-account-page',
  imports: [RouterLink, DateHeadingPipe, MoneyPipe],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <a routerLink="/" class="text-sm font-medium underline">Till översikten</a>

      @switch (status()) {
        @case ('loading') {
          <p aria-live="polite">Hämtar transaktioner…</p>
        }
        @case ('notFound') {
          <p role="alert">Kontot finns inte.</p>
        }
        @case ('failed') {
          <p role="alert">Transaktionerna kunde inte hämtas. Försök igen senare.</p>
        }
        @default {
          @let shown = account();
          @if (shown) {
            <header>
              <h1 class="text-3xl font-semibold tracking-tight">{{ shown.name }}</h1>
              <p class="mt-1 text-zinc-600 dark:text-zinc-400">{{ shown.bank }}</p>
            </header>
          }
          @if (groups().length === 0) {
            <p>Inga transaktioner ännu.</p>
          }
          @for (group of groups(); track group.date) {
            <section
              [attr.data-date]="group.date"
              class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 class="text-lg font-semibold">{{ group.date | dateHeading }}</h2>
              <ul class="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                @for (transaction of group.transactions; track transaction.id) {
                  <li data-transaction class="flex items-baseline justify-between gap-3 py-2">
                    <span class="flex flex-col">
                      <span data-description>{{ transaction.description }}</span>
                      @if (transaction.status === 'pending') {
                        <span class="text-sm text-zinc-500 dark:text-zinc-400">Reserverad</span>
                      }
                    </span>
                    <span
                      data-amount
                      class="font-medium tabular-nums"
                      [class.text-emerald-600]="transaction.amount.amount > 0"
                      [class.dark:text-emerald-400]="transaction.amount.amount > 0"
                      >{{ transaction.amount.amount | money: transaction.amount.currency }}</span
                    >
                  </li>
                }
              </ul>
            </section>
          }
          @if (moreFailed()) {
            <p role="alert">Fler transaktioner kunde inte hämtas.</p>
          }
          @if (cursor() !== null) {
            <button
              type="button"
              data-more
              class="self-start font-medium underline"
              [disabled]="loadingMore()"
              (click)="loadMore()"
            >
              Visa fler
            </button>
          }
        }
      }
    </main>
  `,
})
export class AccountPage {
  private readonly service = inject(TransactionsService);
  private readonly accountId = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));

  protected readonly status = signal<Status>('loading');
  protected readonly account = signal<Account | undefined>(undefined);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);
  private readonly transactions = signal<Transaction[]>([]);

  /** The transactions, already newest first, split into one group per day. */
  protected readonly groups = computed<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const transaction of this.transactions()) {
      const last = groups.at(-1);
      if (last?.date === transaction.date) last.transactions.push(transaction);
      else groups.push({ date: transaction.date, transactions: [transaction] });
    }
    return groups;
  });

  constructor() {
    this.service.list(this.accountId).subscribe({
      next: (page) => {
        this.account.set(page.account);
        this.transactions.set(page.transactions);
        this.cursor.set(page.nextCursor);
        this.status.set('ready');
      },
      error: (error: unknown) =>
        this.status.set(
          error instanceof HttpErrorResponse && error.status === 404 ? 'notFound' : 'failed',
        ),
    });
  }

  protected loadMore(): void {
    const before = this.cursor();
    if (before === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    this.service.list(this.accountId, before).subscribe({
      next: (page) => {
        this.transactions.update((shown) => [...shown, ...page.transactions]);
        this.cursor.set(page.nextCursor);
        this.loadingMore.set(false);
      },
      error: () => {
        this.moreFailed.set(true);
        this.loadingMore.set(false);
      },
    });
  }
}
