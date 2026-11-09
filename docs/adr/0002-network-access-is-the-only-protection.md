---
status: accepted
---

# No login in the app for now; network access is the only protection

The app shows the owner's complete transaction history but has no login yet. That's acceptable only because it cannot be reached from the internet. `bankapp.hew.ovh` resolves publicly, but to an internal IP, and Caddy serves it only on the home LAN and the tailnet. A username and password login is planned as a later feature.

## Consequences

- Exposing the app publicly in any way (port forwarding, a public reverse proxy, a tunnel) is unsafe until login exists.
- Anyone on the home LAN or the tailnet can see everything in the app.
