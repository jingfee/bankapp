import type { WELL_KNOWN_SUBCATEGORIES as Shared } from '@bankapp/shared';

/**
 * The subcategories the backend finds by name. A copy of `WELL_KNOWN_SUBCATEGORIES` in
 * `@bankapp/shared`: the runtime image does not contain the shared package, so backend code
 * imports only types from it (ADR 0016). The check below fails to compile if the two drift apart.
 */
export const WELL_KNOWN_SUBCATEGORIES = {
  savings: { category: 'Överföring', name: 'Sparande & investeringar' },
  settlement: { category: 'Överföring', name: 'Avräkning delade utgifter' },
  mortgage: { category: 'Boende & Hushåll', name: 'Bolån ränta & amortering' },
} as const;

const sameAsShared: typeof WELL_KNOWN_SUBCATEGORIES extends typeof Shared
  ? typeof Shared extends typeof WELL_KNOWN_SUBCATEGORIES
    ? true
    : never
  : never = true;
void sameAsShared;
