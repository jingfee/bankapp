/**
 * The fixed palette a category's colour is picked from. `colour` is the base, used for the icon's
 * background and ring and for bars; `tint` is a lighter shade of it for the icon's stroke, so the
 * glyph reads on the dark theme's tinted background.
 */
export const CATEGORY_PALETTE = {
  red: { colour: '#ef4444', tint: '#fca5a5' },
  orange: { colour: '#f97316', tint: '#fdba74' },
  amber: { colour: '#f59e0b', tint: '#fcd34d' },
  green: { colour: '#22c55e', tint: '#86efac' },
  emerald: { colour: '#10b981', tint: '#6ee7b7' },
  teal: { colour: '#14b8a6', tint: '#5eead4' },
  cyan: { colour: '#06b6d4', tint: '#67e8f9' },
  sky: { colour: '#0ea5e9', tint: '#7dd3fc' },
  blue: { colour: '#3b82f6', tint: '#93c5fd' },
  indigo: { colour: '#6366f1', tint: '#a5b4fc' },
  violet: { colour: '#8b5cf6', tint: '#c4b5fd' },
  purple: { colour: '#a855f7', tint: '#d8b4fe' },
  pink: { colour: '#ec4899', tint: '#f9a8d4' },
  rose: { colour: '#f43f5e', tint: '#fda4af' },
  slate: { colour: '#64748b', tint: '#cbd5e1' },
  gray: { colour: '#6b7280', tint: '#d1d5db' },
} as const;

export type CategoryColour = keyof typeof CATEGORY_PALETTE;

export const CATEGORY_COLOURS = Object.keys(CATEGORY_PALETTE) as CategoryColour[];
