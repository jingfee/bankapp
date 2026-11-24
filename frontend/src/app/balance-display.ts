/** Who owes whom on the settlement's balance: positive means the partner owes the owner. */
export function owesText(balance: number): string {
  if (balance === 0) return 'Ni är kvitt';
  return balance > 0 ? 'Partnern är skyldig dig' : 'Du är skyldig partnern';
}
