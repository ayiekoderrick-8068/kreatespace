# Running the checks

Everything below runs in GitHub Actions on every push to `main` and every pull request
(`.github/workflows/ci.yml`). This page explains how to run the same checks on your own computer.

## The checks

| Command                         | What it checks                                                               |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm lint`                     | Code rules (ESLint) in every package                                         |
| `pnpm typecheck`                | TypeScript types in every package, including the browser tests               |
| `pnpm format:check`             | Code formatting (Prettier)                                                   |
| `pnpm test`                     | Unit and API tests (see "Database-backed tests") and website component tests |
| `pnpm build`                    | Production builds of the API and the website                                 |
| `pnpm test:e2e`                 | Real-browser journeys, screen-size checks and accessibility checks           |
| `pnpm audit --audit-level high` | Known vulnerabilities in dependencies                                        |

## Database-backed tests

Most API tests exercise the real database. Point `TEST_DATABASE_URL` at an **empty, migrated
PostgreSQL database that you do not mind being wiped**; the tests delete users and everything linked
to them between runs.

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kreatespace_test
export TEST_DATABASE_URL=$DATABASE_URL
pnpm --filter @kreatespace/api db:deploy      # apply migrations
pnpm test
```

Without `TEST_DATABASE_URL`, those suites are **skipped** (reported as skipped, not passed), so a
green run on a machine with no database proves less than a green run in CI. If you see a lot of
skipped tests, check the variable.

Never set it to a production or staging database.

## Browser tests (Playwright)

```bash
pnpm --filter @kreatespace/e2e exec playwright install chromium
export E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kreatespace_e2e
pnpm --filter @kreatespace/api db:deploy      # with DATABASE_URL pointing at that database
pnpm test:e2e
```

- The tests start the real API and website themselves. Supabase sign-in and storage are replaced by
  small stand-ins in the browser, so no external account is needed.
- Each test runs on three device profiles: an Android phone, an iPhone, and a desktop. The
  `layout.spec.ts` file checks every page at six screen widths (320 to 1920 pixels) on the desktop
  profile only, and `accessibility.spec.ts` runs the automated axe checks (WCAG 2 A and AA).
- On a fresh Linux machine the browser may fail to start with "error while loading shared
  libraries". Install them with `pnpm --filter @kreatespace/e2e exec playwright install --with-deps chromium`
  (needs administrator rights).
- The very first run after installing dependencies can fail a test or two while the development
  server prepares its files. Re-run just those tests; if they pass, it was start-up timing.
- Automated accessibility checks find roughly a third of real-world problems. They do not replace
  trying the site with a keyboard and a screen reader.

## What is deliberately not automated

- Sending a real WhatsApp message (tests only check the link and its prepared text).
- Real email delivery and Supabase Auth itself.
- Visual comparison against the Figma designs.
- Load testing; see `docs/PERFORMANCE.md` for what was measured.
