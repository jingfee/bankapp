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

Never commit `.env` files, `*.pem` keys or database files: the repository is public.
