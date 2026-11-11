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
_Avoid_: Reserved, waiting, authorised, reservation (as a separate thing from its booked transaction)

**Transaction date** (sv: _Transaktionsdatum_):
The day the owner made the transaction, e.g. paid in a shop. Transactions are listed under this day.
_Avoid_: Purchase date, date (unqualified)

**Booking date** (sv: _Bokföringsdatum_):
The day the bank booked the transaction, often a few days after the transaction date. A pending transaction has none.
_Avoid_: Settlement date, posting date

### Syncing

**Sync** (sv: _Uppdatering_):
One run of fetching balances and transactions for every account on active connections and storing them.
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
A top-level grouping of what money was spent on or came from, such as Boende & Hushåll. It has its own icon and colour, and holds one or more subcategories. The app starts with a default set; the owner can add, rename, reorder and remove expense categories, while the single income category and the single Överföring category are fixed and only gain or lose subcategories.
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

**Confirmed category** (sv: _Bekräftad kategori_):
A subcategory the owner chose or accepted for a transaction. The app never changes a confirmed category on its own.
_Avoid_: Manual category, locked category
