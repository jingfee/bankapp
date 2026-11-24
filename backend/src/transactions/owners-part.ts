// Pure money rounding, kept apart from shares.ts so pure modules can use it without Nest or the database.

/**
 * The owner's part of `amount` at `percent`: rounded half away from zero to whole öre, so a
 * purchase and its full refund always add up to 0 kr (see Owner's part in CONTEXT.md).
 */
export function ownerPart(amount: number, percent: number): number {
  const ore = Math.round(Math.abs(amount) * 100);
  return signed(amount, Math.round((ore * percent) / 100) / 100);
}

/** `value` rounded half away from zero to whole öre, never negative zero. */
export function roundOre(value: number): number {
  return signed(value, Math.round(Math.abs(value) * 100) / 100);
}

const signed = (like: number, magnitude: number) => (like < 0 ? -magnitude || 0 : magnitude);
