import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ShareOption, Transaction } from '@bankapp/shared';
import { TransactionCategoryBadge } from '../category-icon/transaction-category-badge';
import { DateHeadingPipe } from '../formatting/date-heading.pipe';
import { MoneyPipe } from '../formatting/money.pipe';

/** The badge of a shared transaction; Jag is the default and has none. */
const SHARE_BADGES: Record<Exclude<ShareOption, 'me'>, string> = {
  half: '50/50',
  household: 'Hushåll',
  partner: 'Partner',
};

const money = new MoneyPipe();

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
        class="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        [class.p-6]="!compact()"
        [class.p-3]="compact()"
      >
        <h2 class="font-semibold" [class.text-lg]="!compact()">{{ group.date | dateHeading }}</h2>
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
                  <span data-account class="text-sm text-zinc-500 dark:text-zinc-400">{{
                    transaction.account
                      ? transaction.account.name + ' · ' + transaction.account.bank
                      : 'Manuell'
                  }}</span>
                  @if (badge(transaction); as label) {
                    <span
                      data-share-badge
                      class="mt-0.5 self-start rounded-full bg-zinc-100 px-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                      >{{ label }}</span
                    >
                  }
                  @if (transaction.status === 'pending') {
                    <span class="text-sm text-zinc-500 dark:text-zinc-400">Reserverad</span>
                  }
                </span>
                <span class="flex flex-col items-end">
                  <span
                    data-amount
                    class="font-medium tabular-nums"
                    [class.text-emerald-600]="transaction.amount.amount > 0"
                    [class.dark:text-emerald-400]="transaction.amount.amount > 0"
                    >{{ transaction.amount.amount | money: transaction.amount.currency }}</span
                  >
                  @if (showOwnShare() && badge(transaction)) {
                    <span
                      data-own-share
                      class="text-sm text-zinc-500 tabular-nums dark:text-zinc-400"
                      >din andel {{ ownShare(transaction) }}</span
                    >
                  }
                </span>
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
  /** Tighter cards, for a list nested inside another card. */
  readonly compact = input(false);
  /** Adds *din andel* under the real amount of shared transactions (Min andel). */
  readonly showOwnShare = input(false);

  protected badge(transaction: Transaction): string | null {
    const option = transaction.share.option;
    return option === 'me' ? null : SHARE_BADGES[option];
  }

  /** The owner's part of the real amount, to the öre. */
  protected ownShare(transaction: Transaction): string {
    const { amount, currency } = transaction.amount;
    const part =
      Math.sign(amount) * (Math.round(Math.abs(amount) * transaction.share.percent) / 100);
    return money.transform(part, currency);
  }

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
