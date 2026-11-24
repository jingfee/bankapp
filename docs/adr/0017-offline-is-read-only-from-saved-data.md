---
status: accepted
---

# Offline is read-only, from saved data

Amends [0012](0012-the-owner-logs-in-with-a-long-lived-session.md) on logging out. The server is reachable only from the home LAN and the tailnet, so the installed app is often offline: no signal, or simply off the tailnet. The owner wants to check numbers then, not change them. Offline, the app shows saved data and allows no changes.

Offline means the app cannot reach its own server, or the server cannot answer (no response, a timeout, or a 502, 503 or 504). Other errors are errors, not offline.

## What is saved

- Every read the owner has opened is kept, as it was last fetched.
- On every start and every return from offline, the app also fetches the current and previous month's overview in both views, the first page of transactions, the review list, everything on the Delat, Bolån, Sparande and Banker pages, accounts and categories. The main pages therefore work offline even if they were not opened recently.
- Saved data older than 30 days is not shown. Logging out deletes it.

## How it behaves offline

- The navigation says the app is offline, and each page says when its own saved data was fetched (_Visar sparad data från …_). That time is when the device fetched it, not when the bank was last synced.
- Once the app has seen it is offline, it shows saved data straight away instead of waiting on every request, and checks the server in the background. When the server answers, the marker goes and every open page refreshes.
- Controls that change something stay where they are, disabled. A form that fails to save because the app went offline stays open with what was entered.
- Something never saved (an older month, a filter never used, a transaction never opened, more pages of the list) says _Inte sparad_ instead of fetching. Saved transactions are not filtered or searched on the device.
- Logging out still works: it deletes saved data at once, and the device ends the server session the next time it is online.

## Considered options

- **Queueing changes made offline** and sending them later was rejected. The owner uses the app from several devices, so queued changes could conflict with changes and syncs made elsewhere. Most of what a change affects (overview totals, the settlement balance, mortgage figures) is worked out on the server, so the device could not show the result honestly until it was back online.
- **Copying the whole history to the device** so that everything, filters included, works offline was rejected as a second database to keep in step with the first. Filtering only what happens to be saved was rejected because partial results look like real ones: "nothing at ICA in March" could just mean March was never saved.
