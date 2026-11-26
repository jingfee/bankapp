import type { PartyNames } from '@bankapp/shared';

/** The names when the server sends none: saved data from before the names existed. */
const DEFAULT_NAMES: PartyNames = { owner: 'Jag', partner: 'Partner' };

/**
 * Which way the settlement balance is to be transferred, e.g. _Att överföra: Partner → Jag_.
 * Positive means the partner transfers to the owner.
 */
export function transferText(balance: number, names: PartyNames = DEFAULT_NAMES): string {
  if (balance === 0) return 'Ni är kvitt';
  const [from, to] = balance > 0 ? [names.partner, names.owner] : [names.owner, names.partner];
  return `Att överföra: ${from} → ${to}`;
}
