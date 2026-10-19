# KreateSpace

**Discover. Connect. Create.**

A Pinterest-inspired platform where customers discover Kenyan creative businesses, explore their creations, and contact sellers directly through their websites or WhatsApp.

## What it does

- **Customers** browse, search and filter approved creations without an account, save favourites,
  and contact businesses on WhatsApp or through their websites.
- **Sellers** (invited during the pilot) register a business, manage up to 20 creations with 5 photos
  each, offer optional service packages, see analytics, and ask for website help.
- **Administrators** invite sellers, review and approve businesses, creations and packages, handle
  website requests, and import content from a seller's own website with the seller's permission.

## Documentation

| Guide                                              | What it covers                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)           | Putting KreateSpace online: Supabase, Render, Vercel, every setting        |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)           | Backups, restore rehearsal, monitoring, what to do when something breaks   |
| [docs/SECURITY.md](docs/SECURITY.md)               | How access is controlled, review findings, importer safeguards, open risks |
| [docs/PILOT_CHECKLIST.md](docs/PILOT_CHECKLIST.md) | Everything to confirm before and during the 15-business pilot              |
| [docs/DATA_INVENTORY.md](docs/DATA_INVENTORY.md)   | What personal data is handled, for the privacy policy and terms            |

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

Database-backed API tests run only when `TEST_DATABASE_URL` points at a migrated PostgreSQL database (CI provides one); without it they are skipped, not failed. Browser tests use Playwright against the real API and database, with Supabase's auth and storage endpoints stubbed in the browser. They cover the customer, seller and administrator journeys on Android, iPhone and desktop profiles, check that every page fits six screen sizes without sideways scrolling, and run automated accessibility (axe) checks:

```bash
pnpm --filter @kreatespace/e2e exec playwright install chromium
E2E_DATABASE_URL=postgresql://… pnpm test:e2e
```

`pnpm audit --audit-level high` checks dependencies, and `scripts/restore-drill.sh` rehearses a database restore (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).

## Discovery

The public site (`/`, `/explore`, `/creations/:id`, `/businesses/:slug`, `/saved`) reads from the `/api/public/*` endpoints. One rule decides what visitors may see (`apps/api/src/discovery/visibility.ts`): a creation is public only when it is **approved with a published revision** and its business is **approved and not suspended**. Every public query, including search, related creations and saved lists, goes through it.

- **Search** uses PostgreSQL full-text search (English stemming, so "cakes" finds "cake") over a creation's title and description, its business name, category and occasion, plus partial matching on titles and business names while typing. Filters (category, occasion, county, city) combine with search, and all of it lives in the page address so results can be shared.
- **Pagination** is one page at a time (24 by default); the API never counts or returns the whole catalogue.
- **Related creations** share a category or occasion with the one being viewed; sharing a county only nudges the order.
- **Images** carry their width and height so layouts don't jump while loading. Set `SUPABASE_IMAGE_TRANSFORMS=true` (needs a Supabase plan with image transformations) to serve resized variants through `srcset`.
- **Saved creations** need an account. Visitors who try to save are invited to log in, and the save finishes after they do.

### Development fixtures

A fresh database has no approved businesses, so the public feed is empty until sellers are invited and approved. To see the pages with content while developing:

```bash
pnpm --filter @kreatespace/api seed:dev            # add labelled placeholder content
pnpm --filter @kreatespace/api seed:dev --remove   # delete it again
```

Everything this adds is plainly marked as a **development fixture** (names start with "Dev Fixture", images say so), and the command refuses to run when `NODE_ENV=production`.
