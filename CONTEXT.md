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
