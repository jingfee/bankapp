---
status: accepted
---

# The app starts from saved data

Builds on [0017](0017-offline-is-read-only-from-saved-data.md). Opening the app used to wait for the server: the route guard asked `/api/auth/me`, and every page fetched its data. Off the tailnet that wait lasted until the request timed out. The owner wants the app to open at once with what the device has saved, and to get fresh data in the background when the server is there.

## What happens on start

- Until `/api/health` first answers, every read the device has saved is answered from saved data at once. A read never saved goes to the server as usual.
- A device with saved data lets the owner past the route guard at once, without asking `/api/auth/me`. Logging out deletes saved data, so saved data means the owner was signed in on this device and did not log out.
- When `/api/health` answers, every read is fetched again in the background, the same way as when the app is back from being offline. Pages keep showing what they have until the new data arrives.
- When `/api/health` does not answer within 3 seconds, the app is offline as in 0017, and the page says when its saved data is from.
- Saved data older than 30 days is not shown, on start or offline.

## Consequences

- For a moment after opening, a page can show saved data without saying so. It is replaced within a second or two on the tailnet, and marked as saved after 3 seconds if not.
- If the server ended the session while the owner was away, the app opens with saved data and goes to the login page when the background refresh is refused with a 401.
