---
status: accepted
---

# Manual transactions sit beside bank transactions

Amends ADR 0001. Some shared costs never reach a connected account: purchases on a card not yet connected, and things the partner paid. The settlement balance (ADR 0008) needs them, and so does the overview, so they are not settlement-only entries but transactions that count everywhere.

A manual transaction is a row in `transactions` with no account, entered by the owner: date, description, amount, subcategory (confirmed), share and paid by (owner or partner). It is always booked, has no raw bank response, and is the only kind of transaction that can be edited or deleted. Lists show _Manuell_ for its account.

Paid by partner: the amount is the full cost and the share is still the owner's part. In the settlement balance the owner owes that part, so it lowers what the partner owes. In the overview, _Min andel_ counts the owner's part and _Hela beloppet_ the full amount, the household's full cost, even though no money left the owner's accounts.

When the card behind manual transactions is later connected, its initial sync brings the same purchases again. The owner replaces each manual transaction with its bank transaction: Review suggests a bank transaction within max(2 kr, 2%) and 5 days of a manual transaction paid by the owner, closest first, also pending ones (ADR 0005). Card purchases in foreign currency match on the SEK amount the card shows. Replacing hides the manual transaction everywhere and gives the bank transaction its subcategory and share; the bank transaction then counts in the settlement balance even when dated before its account was first connected, because it stands in for one that did. If the bank drops a replacing pending transaction, the manual one comes back. _Inte samma_ stores the pair so it is not suggested again.

## Considered Options

- **Settlement-only entries:** simpler, but purchases on an unconnected card would be missing from the overview.
- **A pseudo-account for manual transactions:** gives every transaction an account, but every account-based rule (sync, renewal, hidden accounts, share) would need an exception for it.
- **Delete the manual transaction when the bank one arrives:** the bank one is dated before its account was connected, so it does not count in the settlement balance and the partner's part would vanish.
- **Keep both:** the overview would count the purchase twice.

## Consequences

- Not every transaction has an account or a raw response; queries that join accounts must keep manual transactions (a left join), and the hidden-account filter never hides them.
- History is no longer only what banks reported; deleting a manual transaction is the owner's choice and is not undone by sync.
- The partner is modelled as far as _Paid by_; they still have no accounts or access.
