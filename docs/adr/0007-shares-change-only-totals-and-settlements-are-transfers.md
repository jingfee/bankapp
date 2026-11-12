---
status: accepted
---

# Shares change only overview totals, and settlements are transfers

The owner splits some costs with another person: the card is shared 50/50, the mortgage in a fixed ratio, and other payments case by case. The owner pays every bill in full, and once a month the other party sends one bank transfer for their part (the settlement, sv: _Avräkning_). The overview should be able to show the owner's own costs.

So each transaction has a share, the percentage the owner bears: its own if set, else its account's, else its subcategory's, else 100%. An offset refund always takes its purchase's share (extending ADR 0006), so a fully refunded shared purchase nets to 0 kr. Shares are applied only when the overview sums totals, and only when the owner picks _Min andel_; every transaction keeps the bank's full amount everywhere else. The settlement is categorised as a transfer (Överföring › Avräkning delade utgifter), so it is in no total.

Shares are current settings, not history: changing an account's or subcategory's share recomputes every month it touches.

## Considered Options

- **Count the settlement as income:** _Hela beloppet_ would then show income the owner did not earn, and _Min andel_ would subtract the other party's part twice (once by the share, once as income).
- **Offset the settlement against the shared purchases:** a refund offsets exactly one purchase (ADR 0006), and the settlement pays for a month of purchases in one sum, so it cannot be linked that way. Without shares, offsetting would also leave the overview unable to show the full amount.
- **Store the owner's part as the transaction's amount:** breaks the one-row-per-bank-transaction record (ADR 0001) and loses the real amount the transaction list must show.
- **Date-ranged shares:** would keep old months stable when a split changes, but adds much complexity for a rare event; a past transaction can be pinned with its own share instead.

## Consequences

- Old months' _Min andel_ totals move when an account's or subcategory's share changes.
- Nothing checks that the settlement matches what the shares say is owed; that is left for a later feature, which shares make possible.
- An uncategorised settlement is outside every total like any other uncategorised transaction, so it does no harm before the owner confirms it.
