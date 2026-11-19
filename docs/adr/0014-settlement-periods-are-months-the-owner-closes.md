---
status: accepted
---

# Settlement periods are months the owner closes, not stretches between settlements

Amends ADR 0008, which kept the running settlement balance and listed periods "each closed by a settlement". In practice the partner usually settles in the last week of the month, now and then sends an extra settlement mid-month, and rarely pays in the first days of the next. Ending a period at every settlement split one month into pieces and gave a late payment its own tiny period.

So a period is a named month (`yyyy-MM`) that the owner closes by hand with _Avsluta månad_ once the money is on the account. Months strictly increase, and a month may be skipped. The close asks for a closing date, which defaults to the date of the latest settlement in the period (when it was reserved, not booked), and the next period's month. Transactions dated on or before the closing date belong to the closed period, later ones to the next, even if they happened before the button was pressed. Only the latest close can be undone, which keeps every other closing date stable.

The balance itself still has no months: closing only groups history, and the balance is identical before and after any close or undo. Late bookings keep landing in the period of their transaction date, so an old period's totals can change while what was paid does not. Periods are stored in `settlement_months(month, closed_through)`, with `closed_through` null for the single open period; the open period is created for the current month on first use, so existing history becomes one open period.

## Considered Options

- **Keep ending periods at each settlement:** simple, but cuts a month in pieces and says nothing about which month a settlement paid for.
- **Calendar months with no close:** no manual step, but the partner's payment often arrives after month end, so a month would look unsettled while it already was paid.
- **Close automatically when a settlement arrives:** an extra settlement mid-month would then close the month too early.

## Consequences

- The owner has to press the button; the Delat page and the overview warn once the open month ended 7 or more days ago.
- Earlier settlements no longer split the existing history; the app has only been live since November 2026, so this loses nothing.
