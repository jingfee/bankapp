---
status: accepted
---

# The household ratio is dated

Amends ADR 0007 for one value. Recurring household costs (mortgage, broadband, electricity and the like) are shared in a ratio the owner and partner agree, which changes now and then, for instance when incomes change. Shares otherwise are current settings, so changing a share recomputes every month it touches. For the household ratio that would rewrite _Min andel_ for every past month and, because the settlement balance is worked out live (ADR 0008), change what was owed in periods already settled.

So the household ratio is a short list of entries, each a whole percentage in force from its date until the next entry. A transaction with the _Hushåll_ option uses the entry in force on its date (its transaction date, not the month it counts in). Adding an entry changes only transactions dated from then on; earlier entries can be edited, which the owner does knowingly. There must always be one entry; before the owner sets one, _Hushåll_ cannot be chosen.

## Considered Options

- **Current setting only, with a new balance setting after each change:** fixes the settlement balance by hand but still moves old overview months, and is easy to forget.
- **Dated shares everywhere:** ADR 0007 rejected this as complex for a rare event; one dated value is not.

## Consequences

- A _Hushåll_ transaction's percentage depends on its date, so totals and the settlement balance look the ratio up per transaction.
- An offset refund takes its purchase's option and the ratio in force on the purchase's date, so a full refund still nets to 0 kr.
