# Development uses the production Enable Banking app and real data

The sandbox only returns invented data, and the open questions about the banks (how they label duplicates, which balance to show, what their pending transactions look like) can only be answered by seeing real data from Skandia, Coop Mastercard and Northmill. So local development uses the production Enable Banking app, with `http://localhost:4200` registered as an extra redirect URL. The usual dev database is a copy of the production one.

## Consequences

- Scheduled syncs are turned off in development. Banks allow about four syncs per day per account across all callers, and development shares that limit with production.
- A copied database contains production's connections, so dev can make a manual sync without a BankID login, which also counts against the shared limit.
- The dev machine holds real financial data and the production private key; both stay out of git (the repo is public).
