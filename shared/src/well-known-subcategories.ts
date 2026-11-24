/**
 * The subcategories the app finds by name rather than id: seeded by migrations and not
 * renameable in the app. `category` is the category they belong to. The backend keeps a copy in
 * `backend/src/db/well-known-subcategories.ts` (it may import only types from this package,
 * ADR 0016); a type check there fails to compile if the two drift apart.
 */
export const WELL_KNOWN_SUBCATEGORIES = {
  /** Net deposits to savings accounts, shown as Sparande in the overview. */
  savings: { category: 'Överföring', name: 'Sparande & investeringar' },
  /** The partner's settlement transfers (ADR 0008). */
  settlement: { category: 'Överföring', name: 'Avräkning delade utgifter' },
  /** The mortgage payment that Bolån follows. */
  mortgage: { category: 'Boende & Hushåll', name: 'Bolån ränta & amortering' },
} as const;
