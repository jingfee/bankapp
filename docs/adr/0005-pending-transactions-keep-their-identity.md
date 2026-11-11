---
status: accepted
---

# Pending transactions keep their identity until they book

Amends ADR 0001, which said pending transactions are replaced on each sync. Once transactions carry a category the owner chose, replacing a pending transaction would throw that choice away, and the owner categorises purchases on the day they make them, long before the bank books them. So a stored pending transaction is matched against what the bank returns on each sync and kept, with its category, while it is still pending and when it becomes booked. Only a pending transaction that the bank stops returning without a booked match (a cancelled reservation) is removed, and its category goes with it.

## Consequences

- Sync needs a rule for recognising the same transaction across syncs and across the pending-to-booked step. The bank's description or amount may change at booking, so the rule is provisional until real data from each bank has been observed (ADR 0003), like the existing dedup rules. The raw responses kept under ADR 0001 let a better rule be re-applied later.
- A wrong match moves a category to the wrong transaction; a missed match loses it and leaves the booked transaction to be guessed again.
