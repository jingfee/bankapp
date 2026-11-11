/** The fixed palette a category's colour is picked from, each with a value per colour scheme. */
export const CATEGORY_PALETTE = {
  red: { light: '#dc2626', dark: '#b91c1c' },
  orange: { light: '#ea580c', dark: '#c2410c' },
  amber: { light: '#d97706', dark: '#b45309' },
  green: { light: '#16a34a', dark: '#15803d' },
  emerald: { light: '#059669', dark: '#047857' },
  teal: { light: '#0d9488', dark: '#0f766e' },
  cyan: { light: '#0891b2', dark: '#0e7490' },
  sky: { light: '#0284c7', dark: '#0369a1' },
  blue: { light: '#2563eb', dark: '#1d4ed8' },
  indigo: { light: '#4f46e5', dark: '#4338ca' },
  violet: { light: '#7c3aed', dark: '#6d28d9' },
  purple: { light: '#9333ea', dark: '#7e22ce' },
  pink: { light: '#db2777', dark: '#be185d' },
  rose: { light: '#e11d48', dark: '#be123c' },
  slate: { light: '#475569', dark: '#334155' },
  gray: { light: '#6b7280', dark: '#4b5563' },
} as const;

export type CategoryColour = keyof typeof CATEGORY_PALETTE;

export const CATEGORY_COLOURS = Object.keys(CATEGORY_PALETTE) as CategoryColour[];
