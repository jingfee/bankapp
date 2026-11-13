---
status: accepted
---

# The settlement is a running balance, not a monthly statement

Follows up ADR 0007, which left checking settlements to a later feature. Before the app, the owner closed each month in a spreadsheet: one column of bills shared 60/40, one of bills shared 50/50 (such as the card invoice), including bills that would only be paid in the coming days. That forces a hard cutoff, and anything paid after it has to be estimated or typed in. Each kind of bill also wants its own cutoff: the card's purchases end when its invoice is paid, while a monthly bill can land on either side of a month boundary.

So the app keeps no months for the settlement at all. The settlement balance is what the partner owes right now, worked out live on every read from the latest balance setting plus every transaction since: the partner's part of what the owner paid, minus the owner's part of what the partner paid (manual transactions, ADR 0009), minus settlements. A bill not yet paid is not yet counted; once it is, the next settlement covers it. Whatever a settlement over- or underpays, by rounding or a late booking, stays in the balance.

The card is shared through its purchases, which carry the card account's share; paying the card invoice is a transfer between the owner's own accounts, so the extra rounded onto that payment does not matter. That is why transfers never count, even though a share applies to every category kind: the card's incoming payment would otherwise count at the card's share.

Rules:

- Counted: every transaction whose share is below 100% and whose category is not a transfer, uncategorised and guessed ones included (their share comes from the account), booked and pending, outside hidden accounts.
- Settlements: every transaction in Överföring › Avräkning delade utgifter, guessed or confirmed, booked or pending. Guessing recognises the partner's transfers.
- Start: a balance setting gives an amount as of a day; transactions dated before it are taken as included. There is no balance until the first setting, and the owner can set it again whenever they like.
- An account counts only transactions dated on or after the day it was first connected, so the history an initial sync brings in does not flood the balance. Those transactions still count in the overview.
- The Avräkning page lists settlement periods, each closed by a settlement, for browsing past settlements.

## Considered Options

- **Monthly statement with a cutoff:** what the spreadsheet did; needs manual numbers for bills paid after the cutoff and a cutoff rule per kind of bill.
- **Card purchases by the card's billing cycle:** the bank gives no cycle dates, and with a running balance the cycle changes nothing owed.
- **Count booked transactions only:** stable but days behind; pending transactions keep their identity (ADR 0005), so counting them cannot count twice, and the balance just follows when one changes or is cancelled.
- **Count from when the app first saw a transaction:** the app does not record that, and it breaks when a new account syncs a year of history.

## Consequences

- The partner pays for bills about a month after they are paid, not in advance as the spreadsheet did; the first balance setting absorbs the switch.
- A pending purchase dated just before a balance setting but reported after it is treated as already included; a manual transaction fixes the rare miss.
- An old settlement period's total can change when a transaction books late; amounts paid never change.
- A wrongly guessed card payment counts until it is categorised as a transfer.
