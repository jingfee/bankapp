import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { ConnectedAccount, Transaction } from '@bankapp/shared';
import { catchError, map, of } from 'rxjs';
import { AccountsService } from '../../accounts.service';
import { DateHeadingPipe } from '../../formatting/date-heading.pipe';
import { MoneyPipe } from '../../formatting/money.pipe';
import { TransactionsService } from '../../transactions.service';

type Status = 'loading' | 'ready' | 'failed';

interface DayGroup {
  date: string;
  transactions: Transaction[];
}

@Component({
  selector: 'app-transactions-page',
  imports: [RouterLink, DateHeadingPipe, MoneyPipe],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      @if (expiringConnection()) {
        <p
          data-connection-banner
          class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          En koppling går ut eller har gått ut.
          <a routerLink="/banker" class="font-medium underline">Gå till Banker</a>
        </p>
      }

      @if (openAccounts(); as open) {
        <ul data-balance-strip class="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          @for (account of open; track account.id) {
            <li
              class="flex shrink-0 flex-col rounded-xl border border-zinc-200 bg-white px-4 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span data-account-name class="text-sm text-zinc-500 dark:text-zinc-400">{{
                account.name
              }}</span>
              <span data-balance class="font-medium tabular-nums">{{
                account.balance ? (account.balance.amount | money: account.balance.currency) : '–'
              }}</span>
            </li>
          }
        </ul>
      }

      @switch (status()) {
        @case ('loading') {
          <p aria-live="polite">Hämtar transaktioner…</p>
        }
        @case ('failed') {
          <p role="alert">Transaktionerna kunde inte hämtas. Försök igen senare.</p>
        }
        @default {
          <header>
            <h1 class="text-3xl font-semibold tracking-tight">Transaktioner</h1>
            <p class="mt-1 text-zinc-600 dark:text-zinc-400">Från alla dina konton.</p>
          </header>
          @if (groups().length === 0) {
            <p>Inga transaktioner ännu.</p>
            @if (!openAccounts()) {
              <a routerLink="/anslut-bank" class="font-medium underline">Anslut bank</a>
            }
          }
          @for (group of groups(); track group.date) {
            <section
              [attr.data-date]="group.date"
              class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h2 class="text-lg font-semibold">{{ group.date | dateHeading }}</h2>
              <ul class="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                @for (transaction of group.transactions; track transaction.id) {
                  <li data-transaction>
                    <a
                      [routerLink]="['/transaktioner', transaction.id]"
                      class="flex items-baseline justify-between gap-3 py-2"
                    >
                      <span class="flex flex-col">
                        <span data-description>{{ transaction.description }}</span>
                        <span data-account class="text-sm text-zinc-500 dark:text-zinc-400"
                          >{{ transaction.account.name }} · {{ transaction.account.bank }}</span
                        >
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
                    </a>
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
export class TransactionsPage {
  private readonly service = inject(TransactionsService);
  private readonly router = inject(Router);
  /** Fetched once; the strip is a convenience, so a failure just leaves it out. */
  private readonly accounts = toSignal(
    inject(AccountsService)
      .list()
      .pipe(
        map((response) => response),
        catchError(() => of(undefined)),
      ),
    { initialValue: undefined },
  );

  /** The accounts that are still open, or null when there are none to show. */
  protected readonly openAccounts = computed<ConnectedAccount[] | null>(() => {
    const open = this.accounts()?.banks.flatMap((group) => group.accounts) ?? [];
    return open.length === 0 ? null : open;
  });

  protected readonly expiringConnection = computed(
    () => this.accounts()?.banks.some((group) => group.status !== 'active') ?? false,
  );

  protected readonly status = signal<Status>('loading');
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
    // Coming back with the browser's back button, show the list as it was left so the router
    // can restore the scroll position; any other visit loads it afresh.
    const left = this.service.listed;
    if (left !== null && this.router.currentNavigation()?.trigger === 'popstate') {
      this.transactions.set(left.transactions);
      this.cursor.set(left.cursor);
      this.status.set('ready');
      return;
    }
    this.service.list().subscribe({
      next: (page) => {
        this.transactions.set(page.transactions);
        this.cursor.set(page.nextCursor);
        this.remember();
        this.status.set('ready');
      },
      error: () => this.status.set('failed'),
    });
  }

  protected loadMore(): void {
    const before = this.cursor();
    if (before === null || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    this.service.list(before).subscribe({
      next: (page) => {
        this.transactions.update((shown) => [...shown, ...page.transactions]);
        this.cursor.set(page.nextCursor);
        this.remember();
        this.loadingMore.set(false);
      },
      error: () => {
        this.moreFailed.set(true);
        this.loadingMore.set(false);
      },
    });
  }

  private remember(): void {
    this.service.listed = { transactions: this.transactions(), cursor: this.cursor() };
  }
}
