import type { CategoryIcon } from './category-icons';
import type { CategoryColour } from './category-palette';

/** Whether a category's transactions count as spending, income, or neither (a transfer). */
export type CategoryKind = 'expense' | 'income' | 'transfer';

/** A subcategory; it has its category's colour and kind. */
export interface Subcategory {
  id: number;
  name: string;
  icon: CategoryIcon;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  colour: CategoryColour;
  icon: CategoryIcon;
  /** True for the single income category and the single transfer category. */
  fixed: boolean;
  /** In the owner's order. */
  subcategories: Subcategory[];
}

/** Response body of `GET /api/categories`, in the owner's order. */
export interface CategoriesResponse {
  categories: Category[];
}
