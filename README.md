# KreateSpace

**Discover. Connect. Create.**

A Pinterest-inspired platform where customers discover Kenyan creative businesses, explore their creations, and contact sellers directly through their websites or WhatsApp.

## Structure

| Path              | Purpose                                         |
| ----------------- | ----------------------------------------------- |
| `apps/web`        | React + Vite + TypeScript frontend              |
| `apps/api`        | Express + TypeScript + Prisma backend           |
| `packages/shared` | Zod validation schemas and types shared by both |

## Requirements

- Node.js 22+
- pnpm 9+

## Getting started

```bash
pnpm install
pnpm dev
```

Environment variables are documented in each app's `.env.example`. Never commit real credentials.

## Configuration

Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`, then fill in your Supabase project values. Real credentials must never be committed. The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is for the API only and must never reach the browser.

```bash
pnpm --filter @kreatespace/api db:migrate   # create/apply migrations (needs DATABASE_URL)
pnpm --filter @kreatespace/api db:deploy    # apply existing migrations
```

### Creating the first administrator

Sign up through the app, sign in once, then promote the account from the server:

```bash
pnpm --filter @kreatespace/api admin:grant you@example.com
```

Administrators then invite business owners from **Admin → Invitations**. Invitation links are shown once; share them with the invited person directly (email delivery is not built yet).

### Image storage

Business photos are stored in a **private** Supabase Storage bucket (`business-media` by default), created by the API on start-up when `SUPABASE_SERVICE_ROLE_KEY` is set. Browsers upload with short-lived signed URLs, and images are shown through short-lived signed read URLs. The bucket limits uploads to JPEG, PNG and WebP up to 5 MB.

## Testing

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Database-backed API tests run only when `TEST_DATABASE_URL` points at a migrated PostgreSQL database (CI provides one). Browser tests use Playwright against the real API and database, with Supabase's auth and storage endpoints stubbed in the browser:

```bash
pnpm --filter @kreatespace/e2e exec playwright install chromium
E2E_DATABASE_URL=postgresql://… pnpm test:e2e
```
