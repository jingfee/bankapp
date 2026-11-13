---
status: accepted
---

# A transaction can count in the month before or after its own

Extends ADR 0006. A monthly bill is sometimes paid on the 1st and sometimes on the last day of a month, when the due date falls on a non-banking day. The overview then shows it twice in one month and not at all in the next, though it is one bill a month.

So the owner can make a transaction count in the month just before or after its date's month. Overview totals and drill-downs use that month; the transaction keeps its date everywhere else. The month is stored on the transaction, not as a date, and a kvittad refund follows its purchase's month as before. The settlement balance has no months (ADR 0008), so it is unaffected.

## Considered Options

- **Accept the double month:** simplest, and wrong a few times a year for a handful of bills.
- **Move repeat payments automatically:** spots a payee's second payment in a month; guesses can be wrong and are hard to notice. It can come later as a guess the owner confirms, like categories.
- **Any month:** nothing needs more than one step, and a limit keeps a mistake small.

## Consequences

- Month totals depend on a per-transaction setting, so a past month can change when the owner moves a transaction into it.
