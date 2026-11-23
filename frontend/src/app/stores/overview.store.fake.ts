import { type Signal, computed, signal } from '@angular/core';
import type { OverviewResponse, OverviewTransactionsResponse } from '@bankapp/shared';
import { type OverviewParams, OverviewStore, type SubcategoryParams } from './overview.store';
import type { ParamRead } from './kept';

/**
 * Answers each read from what the test put in `overviews` (keyed `month view`, e.g.
 * `2026-11 mine`) and `drillDowns` (keyed `month subcategoryId`): a response, 'error', or
 * nothing at all while it is still loading. `requested` lists every parameter set asked for.
 */
export class FakeOverviewStore extends OverviewStore {
  readonly overviews = signal<Record<string, OverviewResponse | 'error'>>({});
  readonly drillDowns = signal<Record<string, OverviewTransactionsResponse | 'error'>>({});
  readonly requested: { overview: OverviewParams[]; drillDown: SubcategoryParams[] } = {
    overview: [],
    drillDown: [],
  };

  private answer<P, T>(
    params: Signal<P | undefined>,
    answers: Signal<Record<string, T | 'error'>>,
    key: (p: P) => string,
    log: P[],
  ): ParamRead<T> {
    const answered = computed(() => {
      const p = params();
      if (p === undefined) return undefined;
      if (!log.some((l) => key(l) === key(p))) log.push(p);
      return answers()[key(p)];
    });
    return {
      value: computed(() => {
        const a = answered();
        return a === 'error' ? undefined : a;
      }),
      loading: computed(() => params() !== undefined && answered() === undefined),
      failed: computed(() => answered() === 'error'),
    };
  }

  overview(params: Signal<OverviewParams>): ParamRead<OverviewResponse> {
    return this.answer(
      params,
      this.overviews,
      (p) => `${p.month} ${p.view}`,
      this.requested.overview,
    );
  }

  subcategoryTransactions(
    params: Signal<SubcategoryParams | undefined>,
  ): ParamRead<OverviewTransactionsResponse> {
    return this.answer(
      params,
      this.drillDowns,
      (p) => `${p.month} ${p.subcategoryId}`,
      this.requested.drillDown,
    );
  }
}
