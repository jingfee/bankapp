import type { PartyNames, ShareOption, Transaction } from '@bankapp/shared';

/** What Hushåll is called; `householdPercentLabel` adds its ratio where it is known. */
const HOUSEHOLD_LABEL = 'Hushåll';

/** What each share option is called: Jag and Partner are the owner's and the partner's names. */
export function shareLabels(names: PartyNames): Record<ShareOption, string> {
  return { me: names.owner, half: '50/50', household: HOUSEHOLD_LABEL, partner: names.partner };
}

/** The options in the order the UI lists them. */
export const SHARE_OPTION_ORDER: readonly ShareOption[] = ['me', 'half', 'household', 'partner'];

/** What a manual transaction shows where an account's name would be. */
export const MANUAL_LABEL = 'Manuell';

/** "Hushåll (60/40)" for the owner's `percent`; plain "Hushåll" when it is not known. */
export function householdPercentLabel(percent: number | undefined): string {
  return percent === undefined
    ? HOUSEHOLD_LABEL
    : `${HOUSEHOLD_LABEL} (${percent}/${100 - percent})`;
}

/** The account's name; a manual transaction is _Manuell_, with the partner's name when they paid it. */
export function accountLabel(
  transaction: Pick<Transaction, 'account' | 'paidBy'>,
  names: PartyNames,
): string {
  if (transaction.account) return transaction.account.name;
  return transaction.paidBy === 'partner' ? `${MANUAL_LABEL} · ${names.partner}` : MANUAL_LABEL;
}

/** Who paid a manual transaction, by name. */
export function paidByLabel(paidBy: Transaction['paidBy'], names: PartyNames): string {
  return paidBy === 'partner' ? names.partner : names.owner;
}
