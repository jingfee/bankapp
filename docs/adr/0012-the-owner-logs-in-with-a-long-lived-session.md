---
status: accepted
---

# The owner logs in, and a login lasts as long as a browser allows

Supersedes [0002](0002-network-access-is-the-only-protection.md). The app shows the owner's complete transaction history, so it now asks for a login before showing anything. Network access is still a layer of protection, not the only one.

## What login protects

Every API route needs a valid session, except `POST /api/auth/login`, the health check and the Enable Banking callback. The callback is public because BankID sends the browser back from another site, and a `SameSite=Strict` cookie is never sent on that navigation; the unguessable `state` of a pending connection is what authorises it. Scheduled syncs and backups run inside the backend and are unaffected. Without a session, the frontend shows only the login page.

## The session model

- There is no registration. One username and a scrypt hash of the password come from the environment (`BANKAPP_USERNAME`, `BANKAPP_PASSWORD_HASH`); the app refuses to start without them, and the password itself is never stored or configured.
- Logging in creates a random 256-bit session id. Only its SHA-256 is stored in the database, with an expiry, so a leaked database cannot be used to sign in. The id lives in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie (`__Host-` prefixed).
- There is no "remember me". Every login lasts **400 days**, the longest lifetime browsers allow for a cookie, because the owner uses the app from a few personal devices and does not want to sign in again. The cost is that a stolen cookie works for as long, so logging out revokes the session on the server, and the cookie cannot be read by scripts or sent from other sites.
- Logging out deletes the session and clears the cookie and the service worker's cached API data. Offline, the data is deleted at once and the session ended when the device is next online ([0017](0017-offline-is-read-only-from-saved-data.md)).
- After 5 failed logins within 15 minutes, logins are refused with 429 until the oldest failure leaves the window. Failures are counted for the whole app, not per address, because there is one owner and a proxy hides addresses. That also means someone who can reach the app can keep the owner locked out; the lockout is short and in memory, so a restart clears it.

## Consequences

- The app is still meant to be reached only from the home LAN and the tailnet. Login is protection if that fails, not permission to expose it publicly: there is no second factor.
- Changing the password means changing `BANKAPP_PASSWORD_HASH`; existing sessions stay valid until they expire or are logged out. Clear the `sessions` table to end them.
