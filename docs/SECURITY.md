# Security notes

This records how KreateSpace is protected, what the pre-launch review found and fixed, and what
remains. **Passing automated checks is not proof of security.** A review by a security professional
is still advisable before the service grows beyond the pilot.

## How access is controlled

- **Sign-in** is handled by Supabase Auth. The API trusts only access tokens whose signature, issuer,
  audience and expiry check out, and only signing algorithms the project actually uses (an unsigned
  or algorithm-swapped token is refused).
- **Roles** (customer, seller, administrator) are stored in the database and checked **on the
  server, before any handler runs**. The website hiding a button is a convenience, never the control.
- **Objects:** a seller can only reach their own business, creations, packages and requests. Other
  people's records answer "not found", exactly like records that do not exist.
- **Public content** follows one rule (`apps/api/src/discovery/visibility.ts`): approved, with a
  published version, from an approved and unsuspended business. Search, related items, saved lists,
  the sitemap, link-preview pages and preview images all use it, so drafts and pending work never leak.
- **Photos** live in a private bucket. Browsers upload with short-lived signed links; the server
  downloads each upload and checks the real file type, size and dimensions before accepting it.
- **Analytics** store no IP address, browser details, account, message or phone number.

## Review findings and what was done

| #   | Finding                                                                                                                                     | Impact                                                                                                  | Fix                                                                                                                                                                                | Evidence                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | On Supabase, every table in the public schema is reachable through the project's REST API with the public `anon` key shipped in the browser | **Critical** on Supabase: user emails, businesses, review notes and private requests readable by anyone | Migration enables row-level security on every table and removes the `anon` and `authenticated` roles' privileges (including for future tables); a test fails if any table lacks it | `security/database.test.ts`; verified on simulated Supabase roles: `anon` could read `users` before, denied after |
| 2   | Sign-up revealed whether an email already had an account ("User already registered"), and raw service errors were shown to visitors         | Account enumeration; technical detail leaked                                                            | Existing addresses look like new sign-ups; only a short allow-list of messages is shown, everything else is generic                                                                | `web/src/auth/errors.test.ts`, `auth.test.tsx`                                                                    |
| 3   | The API would start in production with a default, wildcard or localhost origin, or no database or storage key                               | Misconfiguration silently shipping                                                                      | Production refuses to start and lists every problem                                                                                                                                | `config/env.test.ts`                                                                                              |
| 4   | Tokens were verified without restricting algorithms                                                                                         | Weaker defence against algorithm-substitution tricks                                                    | Only the project's algorithms are accepted                                                                                                                                         | `auth/token-algorithms.test.ts`                                                                                   |
| 5   | No general rate limit; only some routes were limited                                                                                        | Easier scraping and abuse                                                                               | A per-IP ceiling on every API route except the health check                                                                                                                        | `http/general-limit.test.ts`                                                                                      |
| 6   | Error logs could include database query values                                                                                              | Personal data in logs                                                                                   | Logs carry only the error type, code and last message line, and stack frames (not the message)                                                                                     | `http/log.test.ts` (this test first caught the stack repeating the message)                                       |
| 7   | The page chrome could scroll sideways on tablets and phones, and scrollable tables were not keyboard-reachable                              | Usability and accessibility, not a data risk                                                            | Fixed                                                                                                                                                                              | `e2e/tests/layout.spec.ts`, `accessibility.spec.ts`                                                               |

Every API route is also covered by an **authorization matrix** (`security/authorization.test.ts`):
all 57 role-restricted routes answer 401 with no valid sign-in and 403 to every other role, wrong-role
writes change nothing, and a source-code count fails the build if a route is added without being
classified.

`pnpm audit` reported no known vulnerabilities in the dependencies at the time of the review. CI
now runs it on every change, and Dependabot proposes updates weekly.

## The website importer

Importing from a seller's website is the riskiest feature, because the server fetches addresses
supplied by people. Controls, each covered by tests in `apps/api/src/imports/`:

- **Authorised sites only.** The domain comes from the business's own approved profile (never typed
  in by an administrator), the business must have confirmed it owns its content, and shared hosting
  domains (such as `vercel.app`) and internal names are refused.
- **No internal networks (SSRF).** Private, loopback, link-local (including cloud metadata at
  `169.254.169.254`), carrier-grade NAT, documentation and reserved ranges are blocked in IPv4,
  IPv6, IPv4-mapped and NAT64 forms. Every resolved address must be public, and a mixed answer is
  refused.
- **DNS rebinding.** The address is checked inside the connection's own lookup and the connection
  uses exactly that address, so DNS cannot answer differently between the check and the connection.
  A test makes the second lookup return an internal address and confirms it is never contacted.
- **Redirects** are followed by hand, at most three, each re-checked against the domain and the
  address rules; moving from https to http is refused.
- **Limits:** standard ports only, no credentials in addresses, 10-second total time, 1.5 MB per
  page and 5 MB per photo, no compression, only HTML and JPEG/PNG/WebP, at most 12 pages, one link
  level deep, obeys `robots.txt`, one import at a time per business and five a day.
- **Nothing goes live automatically.** Pages become proposals; an administrator picks a category and
  imports one as a private **draft**; the seller must submit it and an administrator must approve it.
  Possible duplicates need explicit confirmation. Photos are re-checked as real images and stored in
  the private bucket; photos on other domains are skipped.
- **Errors** shown to administrators are short codes in plain words, never addresses or raw errors.

## Known limits and open risks

- **Content security policy allows inline styles** (`style-src 'unsafe-inline'`), because the app
  sets a few style attributes (such as image aspect ratios). Scripts are restricted to the site.
- **Administrator two-step verification is enforced** by the API on every administrator route
  (authenticator app, `aal2`), and production refuses to start with `ADMIN_MFA_REQUIRED=false`.
  Customers and business owners are not required to use it. A lost authenticator is reset by the
  owner with `admin:reset-mfa` after confirming the person's identity.
- **Account deletion** needs a sign-in less than 10 minutes old (checked by the server, not the
  page), waits 14 days, and for business owners needs an administrator's approval. It is carried out
  by the maintenance job, never by a web request. See `docs/ACCOUNT_DELETION.md`. Restoring an old
  backup brings deleted accounts back; re-apply the completed deletions after any restore.
- **Rate limits are per instance by default** (kept in memory). Run a single API instance, or set
  `RATE_LIMIT_STORE=postgres` so several instances share their counters (one small database write
  per API request). If the shared counters cannot be reached, behaviour depends on the route:
  public browsing and anonymous analytics carry on without limits (an outage should not take the
  site down), while invitation-token checks and every signed-in action that changes data (uploads,
  imports, account deletion and data export) answer `503 RATE_LIMIT_UNAVAILABLE` with
  `Retry-After: 30` until the counters return. Sign-in and password recovery are Supabase's own
  endpoints and use Supabase's limits, not these.
- **Imports run inside the API process** and are not durable: a restart interrupts them (they are
  marked failed and can be restarted).
- **No error-tracking service** and no web application firewall are installed; the host's basic
  protection and uptime alerts are the safety net.
- **Supabase's default email sender** is for testing and is rate-limited: configure your own SMTP.
- **No third-party penetration test** has been done.
- **A `pg` deprecation warning** ("client.query() while already executing a query") appears in test
  and e2e output. **Cause (traced with `--trace-deprecation`):** `@prisma/adapter-pg`
  (`PgTransaction.performIO`) lets Prisma run some queries at the same time on one connection inside
  an interactive transaction. It is not application code. 7.10.1 is the latest stable adapter, and
  the only newer Prisma is an 8.0 release candidate, so there is no safe supported fix yet. With
  `pg` 8 it is only a warning and behaviour is correct; `pg` 9 would turn it into an error. A test
  (`security/dependencies.test.ts`) fails if `pg` is raised to 9 first. Revisit when Prisma 8 is
  stable. _Re-checked on 20 October 2026 with `npm view`:_ `prisma` is still only at
  `8.0.0-rc.23` (a release candidate, although npm tags it `latest`) and `@prisma/adapter-pg`'s
  `latest` is still 7.10.1, so there is still no stable fix to move to.
- **Legal and privacy documents are drafts.** The terms, seller terms and privacy policy pages
  exist and acceptance is recorded, but a lawyer has not reviewed them (see
  `docs/PILOT_CHECKLIST.md`).

## Reporting a problem

Decide and publish a contact address for security reports (for example `security@<your domain>`)
and who reads it, before launch.
