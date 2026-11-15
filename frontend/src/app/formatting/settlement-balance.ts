import { MoneyPipe } from './money.pipe';

const money = new MoneyPipe();

/** The settlement balance in words: `4 312,00 kr att få`, or `att betala` when it is negative. */
export function balanceText(balance: number): string {
  return balance < 0
    ? `${money.transform(-balance)} att betala`
    : `${money.transform(balance)} att få`;
}
