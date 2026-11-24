/**
 * The subcategories the backend finds by name rather than id: seeded by migrations and not
 * renameable in the app. `category` is the category they belong to. The frontend never needs
 * the names: when it needs one of these subcategories, the response carries its id (ADR 0016).
 */
export const WELL_KNOWN_SUBCATEGORIES = {
  /** Net deposits to savings accounts, shown as Sparande in the overview. */
  savings: { category: 'Överföring', name: 'Sparande & investeringar' },
  /** The partner's settlement transfers (ADR 0008). */
  settlement: { category: 'Överföring', name: 'Avräkning delade utgifter' },
  /** The mortgage payment that Bolån follows. */
  mortgage: { category: 'Boende & Hushåll', name: 'Bolån ränta & amortering' },
} as const;
