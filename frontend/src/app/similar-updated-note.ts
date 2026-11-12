/** Tells the owner how many other transactions a chosen category was applied to; null when none. */
export function similarUpdatedNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 liknande transaktion uppdaterades'
    : `${count} liknande transaktioner uppdaterades`;
}
