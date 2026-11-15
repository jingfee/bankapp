export const CLOCK = Symbol('CLOCK');
export type Clock = () => Date;

/** The day of `date` as `YYYY-MM-DD`, in the server's own time like the frontend's. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Whether `value` is a real calendar day as `YYYY-MM-DD`. */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
