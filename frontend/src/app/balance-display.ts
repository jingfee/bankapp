/**
 * Who owes whom on the settlement's balance: positive means the partner owes the owner.
 * `zero` words the settled case, which the pages have said differently.
 */
export function owesText(balance: number, options: { zero?: string } = {}): string {
  if (balance === 0) return options.zero ?? 'Ni är kvitt';
  return balance > 0 ? 'Partnern är skyldig dig' : 'Du är skyldig partnern';
}
