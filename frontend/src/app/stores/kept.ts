import { type HttpResourceRef, type HttpResourceRequest, httpResource } from '@angular/common/http';
import { type Signal, computed, effect, linkedSignal, untracked } from '@angular/core';

/**
 * The value of a read that keeps what it fetched before when a refresh fails, and forgets it
 * when the read is no longer `active`. Undefined until the first fetch succeeds.
 */
export function keptValue<T>(
  resource: HttpResourceRef<T | undefined>,
  active: Signal<boolean>,
): Signal<T | undefined> {
  return linkedSignal<{ value: T | undefined; active: boolean }, T | undefined>({
    source: () => ({ value: resource.hasValue() ? resource.value() : undefined, active: active() }),
    computation: (next, previous) => next.value ?? (next.active ? previous?.value : undefined),
  });
}

/** A read with parameters: what a store hands a page for one month, filter or id. */
export interface ParamRead<T> {
  /** The latest fetch for the current parameters; undefined until the first succeeds. */
  readonly value: Signal<T | undefined>;
  /** True while the first fetch for the current parameters is under way. */
  readonly loading: Signal<boolean>;
  /** True when it could not be fetched and there is nothing older to show for these parameters. */
  readonly failed: Signal<boolean>;
}

/**
 * Wraps a resource whose request follows `params` (undefined params: nothing is fetched).
 * A refresh that fails keeps what was fetched before for the same parameters; new parameters
 * start from nothing. `version` changing (a fact fired) fetches again without clearing it.
 * Call it where the owner lives, in an injection context, so the read ends with the page.
 */
export function paramRead<P, T>(
  params: Signal<P | undefined>,
  url: (params: P) => HttpResourceRequest,
  version: Signal<number>,
): ParamRead<T> {
  const resource = httpResource<T>(() => {
    const p = params();
    return p === undefined ? undefined : url(p);
  });
  let seen = untracked(version);
  effect(() => {
    const current = version();
    if (current === seen) return;
    seen = current;
    untracked(() => resource.reload());
  });
  const value = linkedSignal<{ value: T | undefined; key: string }, T | undefined>({
    source: () => ({
      value: resource.hasValue() ? resource.value() : undefined,
      key: JSON.stringify(params() ?? null),
    }),
    computation: (next, previous) =>
      next.value ?? (previous?.source.key === next.key ? previous.value : undefined),
  });
  return {
    value,
    loading: computed(() => resource.isLoading() && value() === undefined),
    failed: computed(() => resource.status() === 'error' && value() === undefined),
  };
}
