# Running KreateSpace: backups, recovery and monitoring

## What needs protecting

| Data                                                       | Where                               | If it is lost                                |
| ---------------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| Accounts and passwords                                     | Supabase Auth                       | People cannot sign in; profiles are orphaned |
| Businesses, creations, review history, analytics, requests | PostgreSQL                          | The site is empty; sellers lose their work   |
| Photos                                                     | Supabase Storage (`business-media`) | Pages show missing images; sellers re-upload |
| Code and configuration                                     | GitHub                              | Rebuild from the last copy                   |

The database and the photos are separate: a database backup does **not** contain the photos, and a
photo backup does not contain the database. Back up both.

## Database backups

1. **Use the platform's backups.** Open the Supabase dashboard → Database → Backups and confirm what
   your plan includes (daily backups on paid plans; point-in-time recovery as an add-on). Free plans
   do not include downloadable backups, so for a pilot with real businesses use a paid plan or take
   your own dumps as below. **Confirm this before launch; it was not checked from the repository.**
2. **Take your own dump regularly** (daily is sensible for the pilot) and keep copies somewhere other
   than Supabase, with a retention such as 14 daily and 3 monthly copies:

   ```bash
   pg_dump --format=custom --no-owner --no-privileges \
     --file="kreatespace-$(date +%F).dump" "$DATABASE_URL"
   ```

   Use the _direct_ connection string for dumps (the pooled one can interrupt long operations), and
   the same PostgreSQL major version for `pg_dump` as the server. A dump contains personal data
   (emails, names, business details): store it encrypted, restrict who can read it, and delete old
   copies on schedule.

3. **Photos.** Supabase Storage is S3-compatible; copy the `business-media` bucket to your own
   storage with a tool such as `rclone` on a schedule (weekly is a reasonable start). The photos
   are the sellers' own work and are hard to replace.

## Testing a restore, safely

A backup you have never restored is a guess. `scripts/restore-drill.sh` rehearses it without
touching production: it takes a backup of the database you point it at (read-only), restores it into
a new throw-away database on a **separate** server, compares every table's row count, checks that
row-level security survived, and drops the scratch database afterwards.

```bash
SOURCE_DATABASE_URL="postgresql://…/postgres"       # production (read-only use)
SCRATCH_SERVER_URL="postgresql://postgres:postgres@localhost:5432"   # a local or scratch server
./scripts/restore-drill.sh
```

It refuses to run if the scratch database would be the source. **Never** point
`SCRATCH_SERVER_URL` at production. To rehearse from a dump file you already have, create a scratch
database yourself and run `pg_restore --no-owner --no-privileges --dbname=<scratch-url> file.dump`,
then `pnpm --filter @kreatespace/api exec prisma migrate status` against it (it should say the
schema is up to date).

Run the drill before launch and then monthly. A drill on seeded data in this repository restored an
81 KB dump with identical counts in all 22 tables, 12 migrations recorded, and row-level security
intact on every table. That proves the procedure, **not** your production backups: run it against
your own.

### Restoring for real

1. Stop writes: put the API in maintenance (stop the Render service) so nothing changes mid-restore.
2. Take a fresh dump of the damaged database first, in case something in it is still useful.
3. Restore into a **new** database or project (not on top of the old one) from the backup you
   chose; check it with the drill's comparisons and `prisma migrate status`.
4. Point `DATABASE_URL` at the restored database, start the API, and check `/api/health` and a
   customer journey.
5. Accounts live in Supabase Auth, not in this database. If you restore into a _different_ Supabase
   project, users must be restored there too, or every `users` row will refer to an account that no
   longer exists. Prefer restoring inside the same project.
6. Tell affected sellers what happened and what was lost (anything since the backup).

## Monitoring

- **Uptime:** point an uptime monitor (UptimeRobot, Better Stack, or similar) at
  `https://<api>/api/health` every minute and at the website's home page. Alert by email or SMS to
  at least two people.
- **Logs:** the API writes to standard output; Render keeps and searches them. Errors are logged as
  `Unhandled error` with the error name, code and a short stack, deliberately without request bodies
  or query values. Passwords, tokens and WhatsApp numbers are never logged.
- **Error alerts (API and daily job):** set `ERROR_WEBHOOK_URL` to the incoming-webhook address of a
  chat or alerting tool (Slack-style tools, Better Stack, Make or Zapier all accept the JSON; the
  `text` field is a one-line summary). The API then sends an alert for every unexpected server
  error (HTTP 500), unhandled rejection or crash, and the daily job for a failed run or failed
  account deletions. An alert holds only the error's name and code, the last line of its message,
  five stack frames and the route with ids replaced (for example `GET /api/public/creations/:id`):
  never request bodies, queries, headers or tokens. The same error alerts at most once every
  10 minutes and at most 10 alerts go out per minute, so one fault is one alert. If the address is
  down the API carries on and the error is still in the log. Production requires `https`. Without
  it the API prints a warning at start-up and errors appear only in the logs. **Not done:** the
  website's own browser errors are not reported anywhere, and there is no Sentry-style grouping or
  history; add one of those before wider launch.
- **Database:** watch Supabase's database size, connection count and slow queries in the dashboard.
- **Capacity:** the API runs as a single instance (see `docs/DEPLOYMENT.md`).

## Routine jobs

The daily `kreatespace-maintenance` job (`pnpm --filter @kreatespace/api maintenance`) removes
analytics events older than 13 months, deletes photos that were uploaded but never used (older than
a day), marks imports interrupted by a restart as failed, removes expired rate-limit counters, and
carries out account deletions that are due (`docs/ACCOUNT_DELETION.md`). It is idempotent. A run in
which any account deletion fails exits with an error, so Render shows it as failed.

## When something goes wrong

| Symptom                               | First checks                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Nobody can sign in                    | Supabase status page; Auth settings (Site URL, redirect URLs); SMTP for verification emails     |
| Every request fails with a CORS error | `CORS_ORIGIN` must equal the website address exactly, including https and no trailing slash     |
| API will not start                    | The start-up error lists every configuration problem; fix them all                              |
| Photos do not load                    | `SUPABASE_SERVICE_ROLE_KEY`, bucket name match on API and website, storage quota                |
| Customers see an empty site           | `GET /api/public/home`; approvals (nothing public until a business and a creation are approved) |
| Import stuck "running"                | It is marked failed after 15 minutes or at the next restart; start another                      |
| Rate-limit errors (429) from everyone | `TRUST_PROXY` too low, so everyone looks like one address                                       |

## Account and data requests

Sellers and customers may ask to see or delete their data. The relevant records are the account
(Supabase Auth plus the `users` table), the business and its revisions, creations and photos,
saved creations, website requests, and audit entries. Analytics events contain no personal data.
Agree and write down who handles such requests and how quickly before launch (see the legal
section of `docs/PILOT_CHECKLIST.md`).
