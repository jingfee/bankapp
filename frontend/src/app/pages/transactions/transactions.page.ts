import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Transaction } from '@bankapp/shared';
import { TransactionList } from '../../transaction-list/transaction-list';
import { TransactionsService } from '../../transactions.service';

type Status = 'loading' | 'ready' | 'failed';

@Component({
  selector: 'app-transactions-page',
  imports: [TransactionList],
  template: `
    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
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
          @if (transactions().length === 0) {
            <p>Inga transaktioner ännu.</p>
          }
          <app-transaction-list [transactions]="transactions()" />
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
  protected readonly status = signal<Status>('loading');
  protected readonly cursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);
  protected readonly transactions = signal<Transaction[]>([]);

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
