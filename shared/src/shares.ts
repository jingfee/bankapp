/**
 * The part of a cost the owner bears (ADR 0007): all of it (`me`, Jag), half (`half`, 50/50),
 * the household ratio (`household`, Hushåll) or none (`partner`, Partner). The option is
 * stored, not a percentage, so the ratio can change in one place.
 */
export const SHARE_OPTIONS = ['me', 'half', 'household', 'partner'] as const;
export type ShareOption = (typeof SHARE_OPTIONS)[number];

/** Where a transaction's effective share comes from. */
export type ShareSource = 'transaction' | 'account' | 'subcategory' | 'purchase' | 'default';

/** The share a transaction counts with, worked out by the backend so the frontend never re-derives it. */
export interface EffectiveShare {
  option: ShareOption;
  /** The owner's whole percentage of the amount, 0 to 100. */
  percent: number;
  source: ShareSource;
}

/** One entry of the household ratio: the owner's percentage in force from a date. */
export interface HouseholdRatioEntry {
  /** `YYYY-MM-DD`. */
  from: string;
  /** The owner's whole percentage, 1 to 99. */
  percent: number;
}

/** Response body of `GET /api/household-ratio` and `PUT /api/household-ratio`, earliest first. */
export interface HouseholdRatioResponse {
  entries: HouseholdRatioEntry[];
}

/** Request body of `PUT /api/household-ratio`: the whole list, at least one entry. */
export type SetHouseholdRatioRequest = HouseholdRatioResponse;

/** Request body of `PUT /api/accounts/:id/share`. */
export interface SetAccountShareRequest {
  share: ShareOption;
}

/** A subcategory whose share is not Jag. */
export interface SubcategoryShare {
  subcategoryId: number;
  share: ShareOption;
}

/** Response body of `GET /api/subcategory-shares`: only subcategories not at Jag. */
export interface SubcategorySharesResponse {
  shares: SubcategoryShare[];
}

/** Request body of `PUT /api/subcategories/:id/share`. */
export interface SetSubcategoryShareRequest {
  share: ShareOption;
}
