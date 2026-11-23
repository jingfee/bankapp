import type { HttpResourceRef } from '@angular/common/http';
import { type Signal, linkedSignal } from '@angular/core';

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
