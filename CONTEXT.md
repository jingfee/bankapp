# Bankapp

A private, single-user app for viewing the owner's bank and credit card transactions, fetched through Enable Banking. Code uses the English terms below; the UI uses the Swedish term given for each.

## Language

**Bankapp**:
The app's name, used unchanged in the Swedish UI (page titles, headings, the installed PWA).
_Avoid_: Bankappen, Bank app, BankApp

### Banks and access

**Owner** (sv: _Ägare_):
The single person the app belongs to and whose money it shows.
_Avoid_: User, customer, account holder

**Bank** (sv: _Bank_):
A financial institution the owner holds accounts with, including card issuers such as Coop Mastercard.
_Avoid_: ASPSP, provider, institution, issuer

**Enable Banking**:
The open-banking service the app uses to reach banks on the owner's behalf.
_Avoid_: API, aggregator, PSD2 provider

**Connection** (sv: _Koppling_):
The owner's time-limited permission, granted with BankID, for the app to read data from one bank. A bank has at most one connection, and it lives on across renewals.
_Avoid_: Session, consent, link, login

**Renewal** (sv: _Förnyelse_):
Granting a connection a new period of validity with BankID, before or after it expires.
_Avoid_: Reconnect, reauthorize, new connection

**Expired connection** (sv: _Utgången koppling_):
A connection whose permission has run out; its accounts keep their history but are no longer synced until it is renewed.
_Avoid_: Disconnected, invalid

### Money

**Account** (sv: _Konto_):
A single bank account or card account at a bank, with a balance and transactions. One connection gives access to one or more accounts.
_Avoid_: Bank account (when a card is meant), login, connection

**Closed account** (sv: _Avslutat konto_):
An account that a renewal no longer returns. It keeps its history and is never deleted, but is no longer synced.
_Avoid_: Deleted, removed, inactive

**Hidden account** (sv: _Dolt konto_):
An account the owner chose to hide on Banker. It is left off the start page and none of its transactions are shown anywhere (lists, review, overview, details). It is still synced, so showing it again brings everything back.
_Avoid_: Deleted, archived, closed account (that is a different thing)

**Account type** (sv: _Kontotyp_):
Whether an account is a payment, savings or card account.
_Avoid_: Product, category

**Card account** (sv: _Kortkonto_):
An account backing a credit card. Its balance is negative when money is owed, and purchases make it more negative.
_Avoid_: Card, credit card (as a separate concept)

**Balance** (sv: _Saldo_):
The amount on an account at a point in time, negative when money is owed.
_Avoid_: Amount, total, debt

**Transaction** (sv: _Transaktion_):
A single movement of money on an account, as reported by the bank. Negative when money leaves the account.
_Avoid_: Entry, payment, purchase

**Booked transaction** (sv: _Bokförd_):
A transaction the bank has finalised; it does not change afterwards.
_Avoid_: Completed, settled, cleared

**Pending transaction** (sv: _Reserverad_):
A transaction the bank has registered but not yet booked; it may change or disappear before booking. A pending transaction that books is the same transaction, not a second one: the owner sees it once, first as pending and then as booked.
The bank may reserve a refund with the wrong sign and describe the merchant slightly differently once booked, so the two are recognised as the same by amount size, currency and the description's letters and digits. Rejected and cancelled attempts (`RJCT`, `CNCL`) are not transactions and are never stored. The bank does not say which card made a purchase, so there is no cardholder.
_Avoid_: Reserved, waiting, authorised, reservation (as a separate thing from its booked transaction)

**Upcoming transaction** (sv: _Kommande_):
A payment the bank has scheduled but that has not happened yet, such as an invoice due or a standing order. The bank reports it as pending, with a booking date to come and no transaction date, unlike a pending card purchase, which has already happened. It is not stored and never shown until the bank books it.
_Avoid_: Pending transaction, reserved

**Transaction date** (sv: _Transaktionsdatum_):
The day the owner made the transaction, e.g. paid in a shop. Transactions are listed under this day.
_Avoid_: Purchase date, date (unqualified)

**Booking date** (sv: _Bokföringsdatum_):
The day the bank booked the transaction, often a few days after the transaction date. A pending transaction has none.
_Avoid_: Value date, posting date

### Syncing

**Sync** (sv: _Uppdatering_):
One run of fetching details, balances and transactions for every account on active connections and storing them. Account details refresh the account's name.
_Avoid_: Fetch, refresh, import

**Initial sync** (sv: _Första uppdatering_):
The sync run right after a connection is granted or renewed, reaching as far back in history as the bank allows.
_Avoid_: Backfill, full sync

**Scheduled sync** (sv: _Schemalagd uppdatering_):
A sync started automatically at fixed times of day, with the owner not present.
_Avoid_: Background job, cron sync, automatic refresh

**Manual sync** (sv: _Manuell uppdatering_):
A sync the owner starts from the app, made on the owner's behalf while they are present.
_Avoid_: Refresh, force sync

### Categorising

**Category** (sv: _Kategori_):
A top-level grouping of what money was spent on or came from, such as Boende & Hushåll. It has its own icon and colour, and holds one or more subcategories. The set of categories and subcategories is built into the app and the owner cannot edit it: guessing refers to subcategories by name, so changing the set is a code change (a migration plus the guessing lists).
_Avoid_: Group, main category, tag

**Subcategory** (sv: _Underkategori_):
A second-level grouping within one category, such as Bolån ränta & amortering under Boende & Hushåll. A transaction is always assigned a subcategory, never a bare category; every category has an Övrigt subcategory for when nothing more specific fits.
_Avoid_: Category (when the second level is meant), tag, label

**Category kind** (sv: _Kategorityp_):
Whether a category is Utgift (expense), Inkomst (income) or Överföring (transfer). There is exactly one Inkomst category and one Överföring category; every other category is an expense category. Every subcategory has its category's kind. The kind, not the sign of the amount, decides how a transaction counts: a refund under an expense category reduces spending rather than counting as income.
_Avoid_: Type, direction, account type

**Spending** (sv: _Utgifter_):
The total of transactions in expense categories, with money leaving the account counted as spending and refunds reducing it.
_Avoid_: Costs, outgoings, debits

**Income** (sv: _Inkomster_):
The total of transactions in income categories.
_Avoid_: Deposits, credits, money in

**Transfer** (sv: _Överföring_):
A transaction assigned a subcategory of the Överföring category, such as paying the card bill or moving money between the owner's own accounts. Transfers count as neither spending nor income.
_Avoid_: Internal transaction, excluded transaction, transfer flag

**Uncategorised transaction** (sv: _Okategoriserad_):
A transaction that has no subcategory assigned, neither guessed nor confirmed.
_Avoid_: Unknown, other, Övrigt

**Guessed category** (sv: _Gissad kategori_):
A subcategory the app assigned to a transaction on its own. It counts in totals like any other but is shown as a guess until the owner confirms or changes it.
_Avoid_: Suggestion, auto-category, prediction

**Review** (sv: _Att granska_):
The list of transactions the owner has yet to confirm, guessed or uncategorised, from November 2026 onwards, when the app went live. Older transactions are not asked about, though they are still guessed and can be categorised by hand.
_Avoid_: Inbox, queue, todo

**Confirmed category** (sv: _Bekräftad kategori_):
A subcategory the owner chose or accepted for a transaction. The app never changes a confirmed category on its own.
_Avoid_: Manual category, locked category

**Offset** (sv: _Kvittning_, verb _kvitta_):
Linking a money-in transaction, a refund, to the one purchase it pays back, such as a returned item or a friend's Swish for their share of a bill. A refund offsets exactly one purchase; a purchase can have several refunds. The refund takes the purchase's subcategory as a confirmed category and follows it when it changes, so the owner changes the purchase, not the refund. In totals the refund counts in the purchase's month (ADR 0006). A purchase that has refunds and a category is not asked about in Review. It likewise takes the purchase's share. Removing the link leaves the refund with that category, counting in its own month again with its own share.
_Avoid_: Match, link (in the UI), reconcile, refund category

### Sharing

**Share** (sv: _Andel_):
The part of a transaction the owner bears, as a percentage; the rest is borne by the other party the owner splits costs with, who is not modelled. 100% means not shared. A share is a whole percentage from 0 to 100. A transaction's share is its own, if the owner set one, otherwise its account's, otherwise its subcategory's, otherwise 100%; an offset refund instead always takes its purchase's share and cannot have its own, so a fully refunded shared purchase adds up to 0 kr for the owner. It applies whatever the category kind, so a refund on a shared card is shared like the purchase. Shares are current settings, not history: changing an account's or subcategory's share changes every month it touches. The transaction itself always keeps the bank's full amount; only overview totals can show the owner's share.
_Avoid_: Split, ratio, portion, my part

**Shared transaction** (sv: _Delad_):
A transaction whose share is below 100%.
_Avoid_: Split transaction, joint transaction

**Settlement** (sv: _Avräkning_):
A transfer from the other party paying back their part of a month's shared transactions. It is a transfer, so it counts in no total; otherwise the owner's share would be reduced twice.
_Avoid_: Repayment, refund, income, offset
