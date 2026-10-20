# Milestone 6.1 checklist

What was fixed after the first launch review, what is still open, and what only the owner can do.
Updated 20 October 2026. Commit hashes are from this repository's `main` branch (nothing has been
pushed). Ticked means built **and** verified here; a tick is never given for something that needs
real credentials, a lawyer or production access.

## Done

| #   | Item                                                            | Commit               | How it was verified                                                                                                                                                                               |
| --- | --------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Account deletion: server workflow and data export               | `53dda3c`            | 23 API tests (retries, provider and storage failure, authorization, review), migration against a test database; a failure in the final database step is covered by the later partial-failure test |
| 2   | Account deletion: customer screens                              | `9e360fc`            | 13 component tests                                                                                                                                                                                |
| 3   | Account deletion: business-owner screens                        | `d040cf0`            | 7 component tests                                                                                                                                                                                 |
| 4   | Account deletion: administrator review                          | `632cf18`            | 10 component tests, 2 API tests                                                                                                                                                                   |
| 5   | Account deletion: browser journeys                              | `7305404`            | 18 browser tests (phone, iPhone, desktop), keyboard-only, automated accessibility checks                                                                                                          |
| 6   | Shared rate limits across several API instances                 | `fb230b5`            | 6 tests against a real database, including simultaneous requests                                                                                                                                  |
| 7   | Rate limits: sensitive routes refuse when counters are down     | `731dd42`            | tests for fail-open and fail-closed, recovery, and which routes are which                                                                                                                         |
| 8   | Photo orientation: stored shape follows how the photo is shown  | `205fdec`            | JPEGs built with every EXIF orientation value                                                                                                                                                     |
| 9   | Search: stored search document instead of rebuilding per query  | `6ff12a8`            | 20,000 creations: 1,475 → 70 ms; results compared with the old computed document; 8 trigger tests                                                                                                 |
| 10  | Less JavaScript on the first page                               | `7a7e652`            | production build: 157 KB → 135 KB compressed preloaded (load time **not** re-measured)                                                                                                            |
| 11  | Browser tests: sign-up, log-in, password reset, access rules    | `3de7eef`            | 27 browser tests across three sizes                                                                                                                                                               |
| 12  | Two failing browser tests fixed (phone logout, timing race)     | `99fdb34`            | both pass on all sizes                                                                                                                                                                            |
| 13  | Error alerts by webhook                                         | `0393407`            | 12 tests, including that nothing from the request is sent                                                                                                                                         |
| 14  | Restore drill: checks triggers/functions, closes open functions | `6824091`            | drill run on the local test database                                                                                                                                                              |
| 15  | Launch documents brought up to date                             | `550b416`, `f04ead1` | read against the code                                                                                                                                                                             |

Later commits (hashes are in `git log`): the partial-failure deletion test, the accessibility audit
now covering the account and deletion pages, and the on-demand screen capture for the design
comparison (`docs/FIGMA_REVIEW.md`).

## Checked and already fine (no commit needed)

- **Photo compression in the browser:** `shrinkImage` (`apps/web/src/lib/uploads.ts`) scales to
  1,600 px, re-saves at quality 0.85, respects camera orientation (`imageOrientation: "from-image"`)
  and never makes a file bigger; covered by `uploads.test.ts` (commit `f4b2c55`).
- **`pg` deprecation warning:** traced to `@prisma/adapter-pg`, not application code. Re-checked on
  20 October 2026: `prisma` is only at `8.0.0-rc.23` and the adapter at 7.10.1, so there is no
  stable fix. A test stops `pg` being raised to 9 (`docs/SECURITY.md`).
- **Administrator two-step verification:** enforced on every admin route and tested
  (commits `24e0799`, `c171e6e`); production refuses to start with it off.
- **Legal pages and acceptance record:** present and linked (`3a8bab3`, `dadc947`), as drafts.

## Open: needs you

| Item                                 | What is needed from you                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Real email** (verification, reset) | Choose an email provider and give Supabase its SMTP details (Authentication → SMTP, `docs/DEPLOYMENT.md` step 4); then send test emails to Gmail and a Safaricom/Yahoo mailbox. Nothing in the code needs changing: Supabase sends these. Invitations are still links shared by hand; sending them by email would need a provider and is not built. |
| **Production backups**               | Confirm what your Supabase plan backs up, set up the scheduled dump and photo copy in `docs/OPERATIONS.md`, and run `scripts/restore-drill.sh` against production (read-only on production, scratch server elsewhere).                                                                                                                              |
| **Kenyan data protection**           | A lawyer to review `/terms`, `/seller-terms`, `/privacy` and `docs/ACCOUNT_DELETION.md`; a decision on Office of the Data Protection Commissioner registration; the retention periods and a named person with a response time for deletion and data requests.                                                                                       |
| **Error alerts**                     | Create an incoming webhook in the chat or alerting tool you use and set `ERROR_WEBHOOK_URL` on the API and the daily job in Render. A Sentry-style service is not set up (needs an account and DSN).                                                                                                                                                |
| **Production configuration**         | Fill the `sync: false` values in `render.yaml`, set `RATE_LIMIT_STORE=postgres` before running more than one API instance, and replace `__API_ORIGIN__` in `apps/web/vercel.json`.                                                                                                                                                                  |
| **Figma comparison**                 | See `docs/FIGMA_REVIEW.md`: the Figma file cannot be read from here.                                                                                                                                                                                                                                                                                |
| **Pilot decisions**                  | Who checks **Admin → Deletions** each business day; who is on call.                                                                                                                                                                                                                                                                                 |

## Open: engineering, not blocking the pilot

- Results rank by word frequency only (a title match does not outrank a description match).
- Website browser errors are not reported anywhere (only the API's are).
- A full-text index for search was deliberately not added (not needed at 70 ms for 20,000 creations).
- Lighthouse was not re-run after the JavaScript reduction; load time is unmeasured.
- The API still runs imports inside its own process (a restart interrupts them).
- No third-party penetration test.
- The automated accessibility audit of admin pages failed once under heavy machine load (a blank page
  was audited) and passed on every re-run; it is timing-sensitive on a slow machine.
