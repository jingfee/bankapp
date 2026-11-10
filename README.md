# Bankapp

A private, Swedish-language web app (installable as a PWA later) for viewing bank and credit card transactions fetched through [Enable Banking](https://enablebanking.com). See [`CONTEXT.md`](CONTEXT.md) for the domain language and [`docs/adr/`](docs/adr/) for key decisions.

The app is called **Bankapp** everywhere, including the Swedish UI (not "Bankappen").

## Layout

A pnpm workspace with three packages:

- `frontend`: Angular app (Tailwind CSS, Vitest)
- `backend`: NestJS API under `/api`, which also serves the built frontend in production (Vitest)
- `shared`: API types used by both (type-only, import with `import type`)

## Development

Requires Node 22.22.3+ (see `.nvmrc`) and pnpm 12.

```bash
pnpm install
pnpm dev          # backend on :3000, frontend on http://localhost:4200 (proxies /api to the backend)
```

| Command          | What it does                                      |
| ---------------- | ------------------------------------------------- |
| `pnpm check`     | Lint, format check, type-check and all tests      |
| `pnpm test`      | Vitest in both apps                               |
| `pnpm typecheck` | TypeScript (including Angular templates)          |
| `pnpm lint`      | ESLint                                            |
| `pnpm format`    | Prettier                                          |
| `pnpm build`     | Production build of frontend and backend          |
| `pnpm start`     | Run the built backend, serving the built frontend |

## Configuration

The backend refuses to start unless all of these are set and valid:

| Variable                          | Meaning                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `ENABLE_BANKING_APPLICATION_ID`   | Enable Banking application id (used as the JWT `kid`)      |
| `ENABLE_BANKING_PRIVATE_KEY_PATH` | Path of the application's RSA private key (PEM), readable  |
| `REDIRECT_URL`                    | Where Enable Banking sends the owner back after BankID     |
| `DATA_DIR`                        | Directory for the SQLite database (`bankapp.db`)           |
| `TIMEZONE`                        | IANA time zone for scheduled jobs, e.g. `Europe/Stockholm` |

Migrations in `backend/src/db/migrations` run automatically on startup. After changing `backend/src/db/schema.ts`, run `pnpm --filter @bankapp/backend exec drizzle-kit generate`. The bank list is fetched on first start and refreshed nightly at 04:00 in `TIMEZONE`.

Never commit `.env` files, `*.pem` keys or database files: the repository is public.
