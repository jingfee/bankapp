import { Injectable, type Signal, computed, forwardRef, inject } from '@angular/core';
import type { OverviewResponse, OverviewTransactionsResponse, OverviewView } from '@bankapp/shared';
import { Invalidation } from './invalidation';
import { type ParamRead, paramRead } from './kept';

/** What the month overview is read for. */
export interface OverviewParams {
  /** `YYYY-MM`. */
  month: string;
  view: OverviewView;
}

/** What a drill-down is read for: one subcategory in one month. */
export interface SubcategoryParams {
  /** `YYYY-MM`. */
  month: string;
  subcategoryId: number;
}

/**
 * The overview only reads, so it has no mutations. Both reads take their parameters as a
 * signal and are live only for as long as the page that asked: call them where the page is
 * created. `Invalidation` refreshes them for `transactions`, `accounts`, `shares`,
 * `settlement` and `banks`.
 */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => HttpOverviewStore) })
export abstract class OverviewStore {
  /** Totals and breakdown of one month, with the month before for comparison. */
  abstract overview(params: Signal<OverviewParams>): ParamRead<OverviewResponse>;
  /**
   * The transactions of one subcategory in one month, newest first. Nothing is fetched while
   * `params` is undefined. The whole month is read at once and the subcategory picked out of it,
   * so every drill-down of a month the device has saved works offline (ADR 0017).
   */
  abstract subcategoryTransactions(
    params: Signal<SubcategoryParams | undefined>,
  ): ParamRead<OverviewTransactionsResponse>;
}

@Injectable()
export class HttpOverviewStore extends OverviewStore {
  private readonly invalidation = inject(Invalidation);

  overview(params: Signal<OverviewParams>): ParamRead<OverviewResponse> {
    return paramRead<OverviewParams, OverviewResponse>(
      params,
      ({ month, view }) => ({ url: '/api/overview', params: { month, view } }),
      this.invalidation.version('overview'),
    );
  }

  subcategoryTransactions(
    params: Signal<SubcategoryParams | undefined>,
  ): ParamRead<OverviewTransactionsResponse> {
    const month = paramRead<string, OverviewTransactionsResponse>(
      computed(() => params()?.month),
      (month) => overviewTransactionsRequest(month),
      this.invalidation.version('overview'),
    );
    return {
      ...month,
      value: computed(() => {
        const subcategoryId = params()?.subcategoryId;
        const all = month.value();
        if (subcategoryId === undefined || all === undefined) return undefined;
        return {
          transactions: all.transactions.filter(
            (t) => t.category?.subcategory.id === subcategoryId,
          ),
        };
      }),
    };
  }
}

/** The read behind a month's drill-downs; the warm-up asks for the same, so it is saved. */
export function overviewTransactionsRequest(month: string) {
  return { url: '/api/overview/transactions', params: { month } };
}
