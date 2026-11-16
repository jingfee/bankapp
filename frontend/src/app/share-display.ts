import type { HouseholdRatioEntry, ShareOption, Transaction } from '@bankapp/shared';

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

/** The household ratio in force on `date`: the latest entry from then or before, else the first. */
export function householdRatioOn(
  entries: readonly HouseholdRatioEntry[],
  date: string | null,
): HouseholdRatioEntry | undefined {
  return entries.filter((e) => date !== null && e.from <= date).at(-1) ?? entries[0];
}

/** "Hushåll (60/40)" for the owner's `percent`; plain "Hushåll" when it is not known. */
export function householdPercentLabel(percent: number | undefined): string {
  return percent === undefined
    ? SHARE_LABELS.household
    : `${SHARE_LABELS.household} (${percent}/${100 - percent})`;
}

/** "Hushåll (60/40)" for the ratio in force on `date`; plain "Hushåll" when there is none. */
export function householdLabel(
  entries: readonly HouseholdRatioEntry[] | null,
  date: string | null,
): string {
  return householdPercentLabel(
    entries === null ? undefined : householdRatioOn(entries, date)?.percent,
  );
}

/** The share option named the way it is chosen; Hushåll shows its ratio when `ratio` is given. */
export function shareLabel(
  option: ShareOption,
  ratio: { entries: readonly HouseholdRatioEntry[] | null; date: string | null } | null = null,
): string {
  return option === 'household' && ratio !== null
    ? householdLabel(ratio.entries, ratio.date)
    : SHARE_LABELS[option];
}

/** The account's name; a manual transaction is _Manuell_, with the partner when they paid it. */
export function accountLabel(transaction: Pick<Transaction, 'account' | 'paidBy'>): string {
  if (transaction.account) return transaction.account.name;
  return transaction.paidBy === 'partner'
    ? `${MANUAL_LABEL} · ${SHARE_LABELS.partner}`
    : MANUAL_LABEL;
}
