---
status: accepted
---

# Frontend reads go through stores, and mutations declare facts

The frontend's per-domain services were one-line `HttpClient` wrappers, and only `TransactionsService` refreshed anything after a mutation. Hiding an account, changing a share or removing a bank left the review count and the transaction list kept for the way back stale (#201). Every page also had its own way of reloading after a change: a refresh method, a manual unsubscribe, a `(changed)` output, a `BehaviorSubject` with polling, or never reloading.

So every frontend read and mutation goes through a store, one per domain: `AccountsStore`, `BanksStore`, `TransactionsStore`, `SharesStore`, `SettlementStore`, `OverviewStore`, `SavingsStore` and `MortgageStore`. Each store is an abstract class used as the DI token. The app provides the HTTP implementation and page specs provide an in-memory fake, so the store's interface is the seam pages are tested against.

- **Reads** are signals backed by Angular's `resource`/`httpResource`, exposing value, loading and error. A read with parameters (a month, filters, an id) takes a signal from the page and is live only while the page is.
- **Mutations** declare what changed as a fact: `transactions`, `accounts`, `shares`, `banks`, `settlement`, `mortgage` or `savings`. One invalidation map decides which reads each fact refreshes, so no page or mutation names another store. A mutation whose response is the updated entity uses it; otherwise the affected reads are fetched again. Updates are never optimistic, because shares and the settlement are worked out on the server.
- **Sync status** lives in `BanksStore`, which polls while a sync is running and fires `banks` when it finishes.

| Fact | Refreshes |
|---|---|
| `transactions` | transaction list and the list kept for the way back, review and its count, transaction details, overview, settlement, mortgage figures |
| `accounts` | accounts, savings, and everything `transactions` refreshes |
| `shares` | transaction list and the list kept for the way back, transaction details, overview, settlement |
| `banks` | everything |
| `settlement` | settlement, overview |
| `mortgage` | mortgage, mortgage figures |
| `savings` | savings, manual savings |

Categories stay cached for the whole session.

## Considered Options

- **Each mutation names the stores to refresh:** spreads "what depends on what" over every mutation again.
- **Refresh everything after any mutation:** simplest, but it resets Banker's sync polling and the list kept for the way back.
- **Observables with a refresh subject:** pages already keep their state in signals, and `resource` gives loading and error state without a busy/failed pair per action.

## Consequences

- A new read or mutation has to be added to a store and, for a mutation, to the fact map; its spec checks which reads a fact refreshes.
- Page specs stub stores instead of scripting HTTP calls with `HttpTestingController`; HTTP is tested in the store specs.
- The fact map over-fetches for rare actions (`banks` refreshes everything), which is cheap for one owner.
- Error codes across the HTTP seam, the overview downloading the whole settlement for one tile, and splitting the large pages are separate decisions.
