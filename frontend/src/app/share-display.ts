import type { ShareOption, Transaction } from '@bankapp/shared';

/** What each share option is called. Hushåll gets its ratio added by `householdLabel` where it is known. */
export const SHARE_LABELS: Record<ShareOption, string> = {
  me: 'Jag',
  half: '50/50',
  household: 'Hushåll',
  partner: 'Partner',
};

/** The options in the order the UI lists them. */
export const SHARE_OPTION_ORDER: readonly ShareOption[] = ['me', 'half', 'household', 'partner'];

/** What a manual transaction shows where an account's name would be. */
export const MANUAL_LABEL = 'Manuell';

/** "Hushåll (60/40)" for the owner's `percent`; plain "Hushåll" when it is not known. */
export function householdPercentLabel(percent: number | undefined): string {
  return percent === undefined
    ? SHARE_LABELS.household
    : `${SHARE_LABELS.household} (${percent}/${100 - percent})`;
}

/** The account's name; a manual transaction is _Manuell_, with the partner when they paid it. */
export function accountLabel(transaction: Pick<Transaction, 'account' | 'paidBy'>): string {
  if (transaction.account) return transaction.account.name;
  return transaction.paidBy === 'partner'
    ? `${MANUAL_LABEL} · ${SHARE_LABELS.partner}`
    : MANUAL_LABEL;
}
