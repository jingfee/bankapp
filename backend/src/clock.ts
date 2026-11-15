export const CLOCK = Symbol('CLOCK');
export type Clock = () => Date;

/** The day of `date` as `YYYY-MM-DD`, in the server's own time like the frontend's. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}
