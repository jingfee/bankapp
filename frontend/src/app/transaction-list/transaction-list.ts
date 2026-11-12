import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Transaction } from '@bankapp/shared';
import { TransactionCategoryBadge } from '../category-icon/transaction-category-badge';
import { DateHeadingPipe } from '../formatting/date-heading.pipe';
import { MoneyPipe } from '../formatting/money.pipe';

interface DayGroup {
  date: string;
  transactions: Transaction[];
}

/** Transactions, newest first, in one card per day; each links to its own page. */
@Component({
  selector: 'app-transaction-list',
  imports: [RouterLink, DateHeadingPipe, MoneyPipe, TransactionCategoryBadge],
  host: { class: 'flex flex-col gap-6' },
  template: `
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
                class="flex items-center gap-3 py-2"
              >
                <app-transaction-category-badge [category]="transaction.category" />
                <span class="flex min-w-0 flex-1 flex-col">
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
  `,
})
export class TransactionList {
  readonly transactions = input.required<Transaction[]>();

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
}
