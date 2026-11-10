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

## Deployment

CI (`.github/workflows/ci.yml`) runs lint, format check, type-check and tests on every pull request. Pushes to `main` run the same checks and then publish a linux/amd64 image to `ghcr.io/jingfee/bankapp`, tagged `latest` and the commit SHA.

To run it in Komodo, start from [`deploy/compose.example.yaml`](deploy/compose.example.yaml) and [`deploy/.env.example`](deploy/.env.example): a volume at `/data` for the database and backups, the Enable Banking private key mounted read-only, and configuration through environment variables. The image runs as a non-root user and has a Docker health check on `/api/health`. Build it locally with `docker build -t bankapp .`.
