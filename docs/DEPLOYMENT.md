# Deploying KreateSpace

This guide takes KreateSpace from this repository to a running pilot. **Nothing in the repository
deploys itself:** `render.yaml` and `apps/web/vercel.json` only describe the setup, and
`autoDeploy` is off, so you decide when each release goes out.

| Part     | Where it runs                     | Configuration                   |
| -------- | --------------------------------- | ------------------------------- |
| Website  | Vercel (static files)             | `apps/web/vercel.json`          |
| API      | Render (managed Node.js 22)       | `render.yaml`                   |
| Database | Supabase PostgreSQL               | Prisma migrations in `apps/api` |
| Sign-in  | Supabase Auth                     | Dashboard settings below        |
| Photos   | Supabase Storage (private bucket) | Created by the API on start-up  |
| Checks   | GitHub Actions                    | `.github/workflows/ci.yml`      |

Other hosts work too. The API is an ordinary Node.js 22 process: build with
`pnpm --filter @kreatespace/api build`, start with `pnpm --filter @kreatespace/api start`, and run
`pnpm --filter @kreatespace/api db:deploy` before each release.

> **What has and has not been verified.** The API, database migrations, backup and restore, and the
> web build are tested in this repository. The Render, Vercel and Supabase dashboards have **not**
> been used from here, so treat the steps below as a checklist to confirm on your accounts, not as a
> guarantee. The security-header policy in `vercel.json` has been checked against the production
> build (see "Before you go live").

## 1. Choose your addresses

Decide two public addresses before you start. Examples: `https://www.example.com` for the website
and `https://api.example.com` for the API. Use **https** for both. They appear in several settings
below and must match exactly.

## 2. Supabase

1. Create a project in the region closest to your customers.
2. **Authentication → URL configuration**
   - Site URL: the website address.
   - Redirect URLs: `<website>/login` and `<website>/reset-password`.
3. **Authentication → Providers → Email**: keep "Confirm email" **on**; set a minimum password
   length of at least 8.
4. **Authentication → SMTP**: configure your own email provider. Supabase's built-in sender is
   heavily rate-limited and is meant for testing; verification and password-reset emails to real
   customers need your own.
5. **Authentication → Rate limits**: leave the defaults on.
6. Optional Google sign-in: enable the provider, then set `VITE_GOOGLE_AUTH_ENABLED=true` on the web
   app.
7. **Database → Connection string**: copy the _pooled_ connection string (the one on port 6543) for
   `DATABASE_URL`. Keep the password out of chat, email and the repository.
8. **Project Settings → API**: note the project URL and the `anon` key (public) and the
   `service_role` key (**secret**: server only).
9. **Storage**: do not create the bucket or add policies. The API creates a _private_ bucket on
   start-up. Afterwards confirm in the dashboard that the bucket is **not public** and that there are
   no storage policies.
10. **Data API**: the migrations enable row-level security on every table and remove access for the
    `anon` and `authenticated` roles, so the public REST API returns nothing. As a second lock you
    may also switch the Data API off (Project Settings → API) because KreateSpace never uses it.

## 3. The API on Render

1. In Render choose **New → Blueprint** and select this repository. It reads `render.yaml`.
2. Enter the secret values when prompted (they are never stored in the repository):

| Variable                    | Value                                                            |
| --------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`              | Pooled connection string from step 2.7                           |
| `SUPABASE_URL`              | Project URL                                                      |
| `SUPABASE_SERVICE_ROLE_KEY` | The `service_role` key. **Never** put it in the web app          |
| `WEB_URL`                   | The website address, e.g. `https://www.example.com`              |
| `API_URL`                   | The API address, e.g. `https://api.example.com`                  |
| `CORS_ORIGIN`               | The same as `WEB_URL` (comma-separate if there is more than one) |

The blueprint also sets `NODE_ENV=production`, `TRUST_PROXY=1` (one proxy in front of the API, so
rate limits see real visitor addresses), `SUPABASE_STORAGE_BUCKET=business-media` and
`SUPABASE_IMAGE_TRANSFORMS=false` (set it to `true` only on a Supabase plan that offers image
transformations).

3. **The API refuses to start with an unsafe configuration.** In production it checks that the
   database, sign-in, storage key and both addresses are set, that the addresses use https, and that
   `CORS_ORIGIN` is not `*` or a local address. The error names every problem at once.
4. Deploy. The release step applies database migrations (`prisma migrate deploy`) before the new
   version takes traffic. It only applies migrations that have been committed; it never resets data.
5. Check `https://<api>/api/health` returns `{"status":"ok"}`.
6. Create the first administrator: sign up on the website, sign in once, then in the Render shell:
   `pnpm --filter @kreatespace/api admin:grant you@example.com`.
7. A daily cron job (`kreatespace-maintenance`) removes analytics events after 13 months, deletes
   photos that were uploaded but never used, and marks interrupted imports as failed. It is safe to
   run more often.

**Run one API instance during the pilot.** By default rate-limit counters live in memory, so several
instances would each count separately. Before running more than one, set `RATE_LIMIT_STORE=postgres`
so they share counters in the database (it adds one small write per API request, so watch database
load; a dedicated store such as Redis would be the next step for heavy traffic).

## 4. The website on Vercel

1. In Vercel import the repository and set **Root Directory** to `apps/web`.
2. Set these environment variables for **Production**:

| Variable                       | Value                                                |
| ------------------------------ | ---------------------------------------------------- |
| `VITE_API_URL`                 | The API address, e.g. `https://api.example.com`      |
| `VITE_SUPABASE_URL`            | Project URL                                          |
| `VITE_SUPABASE_ANON_KEY`       | The public `anon` key only                           |
| `VITE_SUPABASE_STORAGE_BUCKET` | `business-media` (must match the API)                |
| `VITE_GOOGLE_AUTH_ENABLED`     | `true` only if Google sign-in is enabled in Supabase |

3. **Edit `apps/web/vercel.json` and replace every `__API_ORIGIN__` with the API's host name**,
   for example `api.example.com` (no `https://`). It appears in the security policy and in the
   rewrites that serve search engines and link previews. The production build **stops with an error**
   if the placeholder, or any variable above, is still missing.
4. Deploy.

### What the website configuration does

- Every page route falls back to `index.html` so links and refreshes work.
- Search engines and link-preview bots that request a creation or business page receive a small
  descriptive HTML page from the API, because the app itself is drawn in the browser. Visitors get
  the normal app. `/sitemap.xml` and `/robots.txt` come from the API too.
- Security headers: HTTPS-only, no framing, no MIME sniffing, a strict content security policy
  (scripts only from the site itself; data only to the site, the API and Supabase), and a limited
  permissions policy.

## 5. Before you go live

- [ ] `https://<api>/api/health` is healthy and `https://<website>/` loads.
- [ ] Sign up, verify the email, log in, log out, and use "Forgot password" with a real mailbox.
- [ ] Invite yourself as a seller, register a business, approve it as admin, upload a creation
      photo, approve it, and see it on the public site.
- [ ] Open the browser console on the live site: there must be **no** "Refused to ..." messages (the
      content security policy), and image uploads must succeed.
- [ ] `https://<website>/sitemap.xml` lists only approved pages; `https://<website>/robots.txt`
      disallows `/admin` and `/seller`.
- [ ] Paste a creation link into WhatsApp: a preview with title and photo appears.
- [ ] In Supabase, the storage bucket is private and the Data API returns nothing for the `anon`
      key (try `GET <project>/rest/v1/users` with the anon key: expect an empty list or an error,
      never data).
- [ ] Take a database backup and restore it somewhere safe (`docs/OPERATIONS.md`).
- [ ] Work through `docs/PILOT_CHECKLIST.md`, including the legal items.

## 6. Releasing a change

1. Merge to `main`; wait for the GitHub Actions run (lint, types, tests, build, browser tests,
   dependency audit) to pass.
2. Trigger the Render deploy, then the Vercel deploy. Release the API first when a change needs new
   database columns, so the new code never meets an old database.
3. Check `/api/health` and one customer journey.

**Rolling back.** Both hosts keep earlier builds: redeploy the previous one. Migrations are
forward-only; a release that changed the database should be reversed with a new corrective
migration, never by editing or deleting an applied one. Take a backup before any release that
changes the database.

## 7. Environment variable reference

**API** (`apps/api/.env.example` has a local-development template)

| Variable                    | Required in production | Notes                                               |
| --------------------------- | :--------------------: | --------------------------------------------------- |
| `NODE_ENV`                  |          yes           | `production`                                        |
| `PORT`                      |           no           | Set by the host                                     |
| `DATABASE_URL`              |          yes           | Pooled PostgreSQL connection string                 |
| `SUPABASE_URL`              |          yes           | Project URL                                         |
| `SUPABASE_SERVICE_ROLE_KEY` |          yes           | Secret; storage access                              |
| `SUPABASE_STORAGE_BUCKET`   |           no           | Default `business-media`                            |
| `SUPABASE_IMAGE_TRANSFORMS` |           no           | `true` only with image transformations              |
| `SUPABASE_JWT_SECRET`       |           no           | Only for projects still on the legacy shared secret |
| `WEB_URL`                   |          yes           | https address of the website                        |
| `API_URL`                   |          yes           | https address of this API                           |
| `CORS_ORIGIN`               |          yes           | Allowed website origin(s)                           |
| `TRUST_PROXY`               |      recommended       | `1` behind one proxy                                |

**Website** (`apps/web/.env.example`): `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_SUPABASE_STORAGE_BUCKET`, `VITE_GOOGLE_AUTH_ENABLED`. These are public by design: only ever
put public values in them.

Never commit real values. `.env` files are ignored by Git; only `.env.example` files are tracked.
