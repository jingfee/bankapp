---
status: accepted
---

# A transaction counts in its own month, even a bill paid early or late

Extends ADR 0006. A monthly bill is sometimes paid on the 1st and sometimes on the last day of a month, when the due date falls on a non-banking day. The overview then shows it twice in one month and not at all in the next, though it is one bill a month.

We accept that. The overview counts every transaction in its transaction date's month, and the owner cannot move it to another month; a kvittad refund still follows its purchase's month (ADR 0006). The settlement balance has no months (ADR 0008), so its amount is the same either way: a bill counts there as soon as it is paid.

An earlier version of this ADR let the owner move a transaction to the month just before or after (_Räknas i månad_, #77). It was dropped before it was built: it mattered only for month-to-month comparisons in the overview, a few times a year, and not enough to justify a per-transaction setting and past months whose totals could change.

## Considered Options

- **Move a transaction to the month before or after:** the earlier decision; cleaner month comparisons, at the cost of a per-transaction setting, and past months whose totals change when the owner moves a transaction into them.
- **Move repeat payments automatically:** spots a payee's second payment in a month; guesses can be wrong and are hard to notice.
- **Any month:** as above, with no limit on how far a mistake can move a transaction.

## Consequences

- A few times a year, a month's total includes one bill twice and the next month's leaves it out; the totals over both months are right.
- Month totals depend only on transaction dates and refund offsets, so a past month changes only when a transaction in it is added, changes or is removed.
- If the double month becomes a nuisance, moving a transaction can be revisited, perhaps as a guess the owner confirms, like categories.
