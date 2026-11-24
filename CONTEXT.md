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

**Removed bank** (sv: _Borttagen bank_):
A bank the owner removed from Banker because they no longer use it. Its connection is no longer synced and is revoked, and its accounts become closed accounts: their transactions keep counting as history, in lists, past months and settlements, and a hidden account stays hidden. Connecting the same bank again brings it back, and its accounts continue where they left off. A savings account of a removed bank either closes or, if the owner chooses, continues as a manual savings account from its last synced balance. A removed bank can later be deleted for good, which erases it and everything it brought in (ADR 0013).
_Avoid_: Deleted bank, disconnected, ended connection

**Offline** (sv: _Offline_):
The app cannot reach its own server, for whatever reason (no signal, not on the home network or the tailnet), or the server cannot answer. The owner can still look at saved data but cannot change anything. It says nothing about any bank's connection.
_Avoid_: Disconnected, frånkopplad, ej ansluten, no connection

**Saved data** (sv: _Sparad data_, shown as _Visar sparad data från …_):
What the app last fetched from its own server and keeps on the device, so pages can be shown while offline. Its age is when the device last fetched it, not when the bank was last synced. It is never older than 30 days, and logging out deletes it, even while offline.
_Avoid_: Cache, stale data, synced data, senast uppdaterad

### Money

**Account** (sv: _Konto_):
A single bank account or card account at a bank, with a balance and transactions. One connection gives access to one or more accounts.
_Avoid_: Bank account (when a card is meant), login, connection

**Closed account** (sv: _Avslutat konto_):
An account that a renewal no longer returns, or a manual savings account the owner closed (e.g. a sold-off ISK). It keeps its history and is never deleted, but is no longer synced or asked for balance entries; on the savings view it counts as 0 from the day it closed.
_Avoid_: Deleted, removed, inactive

**Hidden account** (sv: _Dolt konto_):
An account the owner chose to hide on Banker. It is left off the start page and none of its transactions are shown anywhere (lists, review, overview, details). It is still synced, so showing it again brings everything back.
_Avoid_: Deleted, archived, closed account (that is a different thing)

**Account type** (sv: _Kontotyp_):
Whether an account is a payment, savings or card account, as the bank reports it. It is a fact about the account, not the owner's choice; whether the owner tracks an account as a savings account is a separate thing.
_Avoid_: Product, category

**Card account** (sv: _Kortkonto_):
An account backing a credit card. Its balance is negative when money is owed, and purchases make it more negative.
_Avoid_: Card, credit card (as a separate concept)

**Balance** (sv: _Saldo_):
The amount on an account at a point in time, negative when money is owed.
_Avoid_: Amount, total, debt

**Transaction** (sv: _Transaktion_):
A single movement of money on an account, as reported by the bank, or a manual transaction. Negative when money leaves the account.
_Avoid_: Entry, payment, purchase

**Manual transaction** (sv: _Manuell transaktion_):
A transaction the owner entered by hand, for money no connected account shows, such as a purchase on a card not yet connected or something the partner paid. It belongs to no account and shows _Manuell_ where the account name would be. The owner gives its date (today by default), description, amount, subcategory and share (the subcategory's by default) and who paid it; its category is confirmed, so it is never in Review. It is always booked, and unlike a bank transaction it can be edited and deleted. It counts in lists, the overview and the settlement balance like any other transaction (ADR 0009).
_Avoid_: Manual entry, cash transaction, adjustment

**Paid by** (sv: _Betald av_):
Who paid a manual transaction: the owner (_Jag_) or the partner (_Partner_). Bank transactions are always paid by the owner. A transaction paid by the partner keeps its full amount and its share still means the owner's part: the owner owes the partner that part, so it lowers the settlement balance instead of raising it.
_Avoid_: Payer, cardholder, owner of the transaction

**Replace** (sv: _Ersätt_):
Linking a manual transaction paid by the owner to the bank transaction that later arrives for the same purchase, once its account is connected. The manual transaction then disappears everywhere and the bank transaction takes its place, with its subcategory and share, including in the settlement balance. Review suggests a bank transaction whose amount is within max(2 kr, 2%) and whose date is within 5 days; _Inte samma_ means that pair is never suggested again. A bank transaction replaces at most one manual transaction, and each pair is suggested only once, closest first. If a replacing pending transaction is dropped by the bank, the manual transaction comes back.
_Avoid_: Merge, match (in the UI), dedupe

**Booked transaction** (sv: _Bokförd_):
A transaction the bank has finalised; it does not change afterwards.
_Avoid_: Completed, settled, cleared

**Pending transaction** (sv: _Reserverad_):
A transaction the bank has registered but not yet booked; it may change or disappear before booking. A pending transaction that books is the same transaction, not a second one: the owner sees it once, first as pending and then as booked.
The bank may reserve a refund with the wrong sign and describe the merchant slightly differently once booked, so the two are recognised as the same by amount size, currency and the description's letters and digits. A purchase in another currency is converted again when it books, so its amount in kronor may differ, and the bank does not say it was in another currency; so amounts within 5% of each other also count as the same when both were made the same day, unless an exact match is found first. Rejected and cancelled attempts (`RJCT`, `CNCL`) are not transactions and are never stored. The bank does not say which card made a purchase, so there is no cardholder.
_Avoid_: Reserved, waiting, authorised, reservation (as a separate thing from its booked transaction)

**Upcoming transaction** (sv: _Kommande_):
A payment the bank has scheduled but that has not happened yet, such as an invoice due or a standing order. The bank reports it as pending, with a booking date to come and no transaction date, unlike a pending card purchase, which has already happened. It is not stored and never shown until the bank books it.
_Avoid_: Pending transaction, reserved

**Transaction date** (sv: _Transaktionsdatum_):
The day the owner made the transaction, e.g. paid in a shop. Transactions are listed under this day, and the overview counts each one in this day's month (a kvittad refund follows its purchase, ADR 0006); the owner cannot move a transaction to another month (ADR 0010).
_Avoid_: Purchase date, date (unqualified)

**Booking date** (sv: _Bokföringsdatum_):
The day the bank booked the transaction, often a few days after the transaction date. A pending transaction has none.
_Avoid_: Value date, posting date

### Savings

**Savings account** (sv: _Sparkonto_):
An account the owner chose to follow by its balance only, such as a savings account or an ISK. It is shown on the savings view with its balance over time, but none of its transactions are shown anywhere (lists, review, overview, settlement balance). It is either a connected account the owner marked as one, which keeps syncing in the background, or a manual savings account. Whatever its account type, an account is a savings account only if the owner says so. A savings account cannot also be hidden; when the owner stops tracking an account as a savings account, its transactions show everywhere again, as when an account is shown again.
_Avoid_: Savings-type account (that is the account type), hidden account (that is not shown at all), investment account

**Manual savings account** (sv: _Manuellt sparkonto_):
A savings account the app cannot reach through Enable Banking, such as an ISK, that the owner keeps up to date with balance entries. It belongs to no connection.
_Avoid_: Manual account, offline account, external account

**Balance entry** (sv: _Saldonotering_):
The owner stating that a manual savings account held a given amount, and its net deposits, on a given day (today by default). Entries are kept as history, at most one per account per day, and can be corrected or deleted. Connected savings accounts get their balance history from syncing instead.
_Avoid_: Balance setting (that is for the settlement balance), snapshot, valuation

**Net deposits** (sv: _Insatt_):
What the owner has put into a savings account in total, minus what was taken out, since the account was opened. For a manual savings account each balance entry states it as the broker shows it; what was deposited in a stretch of time is the difference between two entries.
_Avoid_: Deposits (for a single transfer), invested capital, contributions

**Growth** (sv: _Utveckling_):
How much a savings account's balance changed by itself rather than by deposits: interest, dividends and price changes. Over a stretch of time it is the change in balance minus the change in net deposits; since the start it is the balance minus net deposits. It can be negative.
_Avoid_: Return, yield, profit, avkastning

### Mortgage

**Mortgage** (sv: _Bolån_):
The owner's home loan, followed by its remaining debt, interest rate and amortisation, which the owner updates by hand. It is not an account and has no transactions of its own; the payments for it are ordinary transactions in Bolån ränta & amortering. The app shows the whole loan as the bank does, not the owner's part.
_Avoid_: Loan (for now there is only the mortgage), debt account, mortgage account

**Loan part** (sv: _Lånedel_):
One part of a mortgage, named by the owner, with its own remaining debt, interest rate and amortisation. A mortgage has one or more loan parts; its debt is their sum. Parts are added and ended as the mortgage is renegotiated: an ended part, paid off or merged into a new one, keeps its history and counts as 0 from the day it ended.

**Remaining debt** (sv: _Kvarvarande skuld_):
What is left to pay on a loan part: the debt in its latest mortgage entry, less its amortisation once for every month after that day in which the mortgage was paid, that is, a month with a booked transaction in Bolån ränta & amortering. Pending payments do not count until they book. The owner corrects it with a new mortgage entry, e.g. after paying extra.
_Avoid_: Balance, loan amount, principal

**Interest rate change** (sv: _Ränteändring_):
The owner stating a loan part's new interest rate, in force from a given day until the next change. The rate is kept until it is changed; the bank's rate cannot be fetched, so the owner enters it.
_Avoid_: Rate update, new rate (as a thing)

**Amortisation** (sv: _Amortering_):
What the owner pays off a loan part each month, in kronor. Like the interest rate, it is kept from a given day until the owner changes it.
_Avoid_: Repayment, instalment, principal

**Rate adjustment day** (sv: _Räntejusteringsdag_):
The day a loan part's interest rate is next reset by the bank, recurring at the part's rate adjustment interval (e.g. every 3 months). On that day the owner is reminded to enter the new rate.
_Avoid_: Bindningstid (that is the interval), rate change day, ränteändringsdag

**Terms change day** (sv: _Villkorsändringsdag_):
The day a loan part's terms can next be renegotiated, recurring at its terms change interval (e.g. every year).
_Avoid_: Renewal (that is for connections), rate adjustment day
_Avoid_: Tranche, sub-loan, loan (for a part)

**Mortgage entry** (sv: _Bolånenotering_):
The owner stating, for a given day (today by default), each loan part's remaining debt as the bank shows it, to start following the mortgage or to correct the remaining debt the app worked out. Entries are kept as history. The interest rate and amortisation are not part of it; they are kept until the owner changes them.
_Avoid_: Balance entry (that is for savings accounts), statement, snapshot

**Estimated monthly payment** (sv: _Beräknad månadsbetalning_):
What the mortgage should cost per month: for each loan part, its remaining debt times the interest rate in force divided by twelve, plus its amortisation. It is an estimate because the bank charges interest by the day; what was actually paid is the month's transactions in Bolån ränta & amortering.
_Avoid_: Monthly cost, instalment, avgift

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

**Savings** (sv: _Sparande_):
What the owner put into savings in a month, net: transactions in Överföring › Sparande & investeringar dated in the month, where money leaving the owner's accounts counts as a deposit and money coming back lowers it. Shown as its own tile on the overview, always at the full amount (savings are not shared), and still in none of Netto, Inkomster or Utgifter. Hidden accounts do not count. Savings accounts are not connected, so each transfer appears once, as its outgoing leg; connecting one would need a second look.
_Avoid_: Net deposits (that is a savings account's lifetime figure)

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
The part of a transaction the owner bears; the rest is borne by the partner. A share is one of four options, never a free percentage: _Jag_ (100%, not shared), _50/50_ (50%), _Hushåll_ (the household ratio in force on the transaction's date) and _Partner_ (0%, the partner bears it all). Transactions, accounts and subcategories store the option, not the percentage. A transaction's share is its own, if the owner set one, otherwise its account's, otherwise its subcategory's, otherwise _Jag_; which accounts and subcategories have which option is the owner's setting, nothing is built in; an offset refund instead always takes its purchase's share and cannot have its own, so a fully refunded shared purchase adds up to 0 kr for the owner. It applies whatever the category kind, so a refund on a shared card is shared like the purchase. Shares are current settings, not history: changing an account's or subcategory's share changes every month it touches. The household ratio is the exception (ADR 0011). The transaction itself always keeps the bank's full amount; only overview totals can show the owner's share.
_Avoid_: Split, ratio, portion, my part, percentage (for the option)

**Owner's part** (sv: _Min andel_):
What the owner bears of a transaction: its share's percentage of the full amount, rounded half away from zero to whole öre, so a purchase and its full refund always add up to 0 kr. _Min andel_ totals on the overview are the sum of each transaction's owner's part.
_Avoid_: My share, own amount, net amount

**Partner's part** (sv: _Partnerns andel_):
What the partner bears of a transaction: the full amount minus the owner's part, so the two always add up to the amount. The settlement balance moves by it for a transaction paid by the owner, and by the owner's part for one paid by the partner.
_Avoid_: Partner share, other half, remainder

**Household ratio** (sv: _Hushållsandel_):
The owner's part of costs shared as _Hushåll_, such as the mortgage, broadband and electricity: a whole percentage, shown as e.g. _Hushåll (60/40)_. It is a short dated list, each entry in force from its date until the next, so changing it leaves earlier transactions, months and settled periods as they were (ADR 0011).
_Avoid_: Custom share, split ratio, household share

**Partner** (sv: _Partner_):
The one other person the owner splits costs with. The partner has no access to the app and no accounts in it; they appear only as who paid a manual transaction and as the sender of settlements.
_Avoid_: Wife, spouse, other party, co-owner

**Shared transaction** (sv: _Delad_):
A transaction whose share is anything but _Jag_.
_Avoid_: Split transaction, joint transaction

**Settlement** (sv: _Avräkning_):
A transfer from the partner paying down the settlement balance, categorised Överföring › Avräkning delade utgifter. It is a transfer, so it counts in no overview total; otherwise the owner's share would be reduced twice. One sent by the owner to the partner has a negative amount and raises the balance.
_Avoid_: Repayment, refund, income, offset

**Settlement balance** (sv: _Avräkningssaldo_):
What the partner owes the owner right now, negative when the owner owes the partner. It starts from the latest balance setting and is worked out live from every transaction since: up by the partner's part, 100% − share, of each transaction paid by the owner (a purchase raises it, a refund or income lowers it); down by the owner's part of each one paid by the partner; and down by each settlement. Transfers, hidden accounts and transactions dated before their account was first connected do not count; pending transactions do, so the balance follows them as they change, book or disappear, and any difference is simply settled next time. It has no months and no cutoff; settlement periods only group its history (ADRs 0008 and 0014).
_Avoid_: Debt, owed amount, settlement total, avräkning (for the balance)

**Balance setting** (sv: _Inställt saldo_):
The owner stating that the settlement balance was a given amount as of a given day (today by default). Transactions dated before that day count as included in it; those dated on or after it count on top. The latest setting wins; earlier ones stay in the history. Until the first one, there is no settlement balance.
_Avoid_: Reset, opening balance, adjustment, manual entry

**Settlement period** (sv: _Avräkningsperiod_):
A named month (e.g. _Oktober 2026_) that the owner closes by hand, as shown on the Delat page: the balance carried in, the partner's part of each transaction dated in it, each settlement paid in it and the balance carried out. Months strictly increase from one period to the next; the open period keeps its month until it is closed, however late. Settlements do not end periods. A transaction that books late can still change a closed period; what was paid never does (ADR 0014).
_Avoid_: Statement, invoice

**Month close** (sv: _Månadsavslut_, the action _Avsluta månad_):
The owner closing the open settlement period once the partner's money has arrived, and opening the next one for a later month. It only groups history: the settlement balance does not change. Only the latest close can be undone (_Ångra avslut_).
_Avoid_: Settle up, reset, archive

**Closing date** (sv: _Avslutsdatum_):
The last day belonging to a closed period: transactions dated on or before it are in that period, later ones in the next, even if they happened before the owner pressed the button. It defaults to the date of the latest settlement in the period, else today, and is never before the previous closing date or after today.
_Avoid_: Cutoff, end date
