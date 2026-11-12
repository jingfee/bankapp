---
status: accepted
---

# A refund offset against a purchase counts in the purchase's month

Spending is computed per month from each transaction's date. A refund that arrives in a later month than its purchase would make spending look too high in the purchase's month and too low in the refund's. So when the owner offsets (kvittar) a refund against a purchase, totals and the overview's drill-down place the refund in the purchase's month, under the purchase's subcategory. A fully returned item adds up to 0 kr in the month of the purchase.

Only totals move. The refund keeps its own date everywhere else (transaction list, detail page). The link is `transactions.offsets_transaction_id`; a refund's subcategory is copied from its purchase whenever the purchase's subcategory is set, guessed or confirmed (`refreshRefundCategories`), so category queries need no special case.

The refund likewise takes its purchase's share (ADR 0007), so a fully returned shared purchase also adds up to 0 kr in the owner's share.

## Considered Options

- **Net the refund into the purchase row:** one number per purchase, but it hides the refund as a transaction and breaks the one-row-per-bank-transaction rule of ADR 0001.
- **Count the refund in its own month and let the owner live with the skew:** simplest, rejected because it is the problem being solved.

## Consequences

- A month's totals can change after the month is over, when a late refund is offset against an old purchase.
- A purchase's month in a total is its `date`, so a refund offset against a purchase from before the app went live moves history, not just the current month.
- Only booked transactions can be offset, because pending ones get a new id when they book.
