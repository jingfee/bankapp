import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CATEGORY_PALETTE, type CategoryColour, type Transaction } from '@bankapp/shared';
import { TransactionCategoryBadge } from '../category-icon/transaction-category-badge';
import { DateHeadingPipe } from '../formatting/date-heading.pipe';
import { MoneyPipe } from '../formatting/money.pipe';
import { SHARE_LABELS, accountLabel } from '../share-display';

const money = new MoneyPipe();

interface DayGroup {
  date: string;
  transactions: Transaction[];
  /** The day's total, or null when the day mixes currencies. */
  sum: { amount: number; currency: string } | null;
}

/** Transactions, newest first, in one card per day; each links to its own page. */
@Component({
  selector: 'app-transaction-list',
  imports: [RouterLink, DateHeadingPipe, MoneyPipe, TransactionCategoryBadge],
  host: { class: 'stagger flex flex-col gap-4' },
  template: `
    @for (group of groups(); track group.date) {
      <section
        [attr.data-date]="group.date"
        class="card overflow-hidden p-1 sm:p-2"
        [class.bg-surface-2]="compact()"
      >
        <h2
          class="flex items-baseline justify-between gap-3 px-2 pt-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase sm:px-3"
        >
          <span>{{ group.date | dateHeading }}</span>
          @if (group.sum; as sum) {
            <span data-day-sum class="amount text-sm tracking-normal normal-case">{{
              sum.amount | money: sum.currency
            }}</span>
          }
        </h2>
        <ul>
          @for (transaction of group.transactions; track transaction.id) {
            @let pending = transaction.status === 'pending';
            <li data-transaction>
              <a
                [routerLink]="['/transaktioner', transaction.id]"
                class="tx-row flex items-start gap-3 rounded-xl px-2 py-2.5 sm:px-3"
              >
                <app-transaction-category-badge
                  class="mt-0.5 shrink-0"
                  [category]="transaction.category"
                  [pending]="pending"
                  [size]="36"
                />
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="flex items-baseline gap-3">
                    <span data-description class="min-w-0 flex-1 truncate font-medium">{{
                      transaction.description
                    }}</span>
                    <span
                      data-amount
                      class="amount shrink-0"
                      [class.text-positive]="transaction.amount.amount > 0 && !pending"
                      [class.text-pending]="pending"
                      >{{ transaction.amount.amount | money: transaction.amount.currency }}</span
                    >
                  </span>
                  <span class="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-center sm:gap-2">
                    @if (transaction.category; as c) {
                      <span
                        data-subcategory
                        class="sm:shrink-0"
                        [style.color]="tint(c.category.colour)"
                        >{{ c.subcategory.name }}</span
                      >
                    } @else {
                      <span data-subcategory class="text-muted italic sm:shrink-0"
                        >Okategoriserad</span
                      >
                    }
                    <span class="flex min-w-0 items-center gap-1.5 text-muted sm:flex-1">
                      <span data-account class="min-w-0 truncate sm:order-last sm:ml-auto">{{
                        accountLabel(transaction)
                      }}</span>
                      <span class="sm:hidden" aria-hidden="true">·</span>
                      <span data-pills class="flex shrink-0 flex-nowrap gap-1.5">
                        @if (badge(transaction); as label) {
                          <span data-share-badge class="pill pill-neutral">{{ label }}</span>
                        }
                        @if (transaction.category && !transaction.category.confirmed) {
                          <span data-guess-pill class="pill pill-guess">Gissad</span>
                        }
                        @if (pending) {
                          <span data-pending-pill class="pill pill-pending">Reserverad</span>
                        }
                      </span>
                    </span>
                  </span>
                  @if (showOwnShare() && badge(transaction)) {
                    <span data-own-share class="text-sm text-muted tabular-nums"
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
  /** For a list nested inside another card: its day cards sit on a lighter surface, not a second card. */
  readonly compact = input(false);
  /** Adds *din andel* under the real amount of shared transactions (Min andel). */
  readonly showOwnShare = input(false);

  protected badge(transaction: Transaction): string | null {
    const option = transaction.share.option;
    return option === 'me' ? null : SHARE_LABELS[option];
  }

  protected tint(colour: CategoryColour): string {
    return CATEGORY_PALETTE[colour].tint;
  }

  protected readonly accountLabel = accountLabel;

  /** The owner's part of the real amount, to the öre. */
  protected ownShare(transaction: Transaction): string {
    return money.transform(transaction.ownerPart, transaction.amount.currency);
  }

  /** The transactions, already newest first, split into one group per day. */
  protected readonly groups = computed<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const transaction of this.transactions()) {
      const last = groups.at(-1);
      if (last?.date === transaction.date) last.transactions.push(transaction);
      else groups.push({ date: transaction.date, transactions: [transaction], sum: null });
    }
    for (const group of groups) {
      const currency = group.transactions[0].amount.currency;
      if (group.transactions.every((t) => t.amount.currency === currency)) {
        const cents = group.transactions.reduce(
          (sum, t) => sum + Math.round(t.amount.amount * 100),
          0,
        );
        group.sum = { amount: cents / 100, currency };
      }
    }
    return groups;
  });
}
