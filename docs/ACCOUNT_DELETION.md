# Account deletion and data requests

How a person's account is deleted, what is kept afterwards, and what an administrator does. This
describes what the software does today. **It is not a legal policy:** the retention periods and the
response time below are engineering defaults that a lawyer must confirm for the Data Protection Act,
2019 (Kenya) before launch.

## What a person can do

On **Account → Delete your account** a signed-in person can:

1. See what deletion removes (their account, sign-in and saved creations; for a business owner also
   the business page, every creation and package, website requests and imports).
2. Confirm it is them: the server accepts a request only if they signed in within the last
   10 minutes. The page asks for their password again; people who signed in with Google just sign in
   again.
3. Tick that they understand, and send the request.
4. Cancel at any time until it is carried out.

Sending the request deletes **nothing**. The screens say so in plain words.

## What happens next

| Who            | Review?                       | Earliest deletion         |
| -------------- | ----------------------------- | ------------------------- |
| Customer       | None                          | 14 days after the request |
| Business owner | An administrator must approve | 14 days after the request |
| Administrator  | Not available from the app    | Removed by the owner      |

- The 14 days (`DELETION_GRACE_DAYS` in `packages/shared/src/legal.ts`) let people change their mind.
- Business owners' requests wait under **Admin → Deletions**. The administrator sees what depends on
  the account (creations, packages, open website requests, running import) and either approves
  (after a confirmation step) or refuses with a reason the person reads on their account page. A
  refused person can ask again.
- A running website import delays deletion until it finishes.
- Deletion is carried out by the daily maintenance job (`pnpm --filter @kreatespace/api maintenance`,
  scheduled in `render.yaml`), so it can happen up to a day after the earliest date.

## What the job does, in order

1. Removes the business's photos from storage.
2. Removes the person's sign-in identity from Supabase Auth (they can no longer log in).
3. In one database transaction: blanks the details stored in related audit entries, deletes
   invitations addressed to the person, the business (which removes its creations, packages, website
   requests, imports, analytics events), the user row (which removes saved creations), and marks the
   request completed with counts only.

Every step can be repeated, so a failure part-way (Supabase or storage down, a database error)
leaves the request due and the next run finishes it. A failed run makes the scheduled job exit with
an error so it shows as failed in Render. Nothing in the database is removed unless the photos and
the sign-in identity were removed first.

## What is kept

| Kept                                                                                     | Why                                                            | For                                                                                                                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A deletion record: role, whether there was a business, dates, counts of what was removed | Proof the deletion happened; answers "was my data deleted?"    | Kept (no personal details; review before launch)                                                                             |
| The deleted account's opaque id                                                          | Stops a still-valid sign-in token creating a new empty account | 8 days, then cleared by the maintenance job                                                                                  |
| Audit-log entries ("a creation was approved")                                            | Accountability                                                 | Kept, with their details (such as an email address) blanked                                                                  |
| Database backups                                                                         | Recovery                                                       | Until the backup expires; **deleted accounts can reappear if a backup is restored**, so re-apply deletions after any restore |

**Not yet decided (needs the lawyer):** whether any records must be kept for tax, fraud or legal
claims, and for how long.

## Getting a copy of your data

`GET /api/me/export` (requires a sign-in within the last 10 minutes) returns the person's own
account, saved list and, for a business owner, the business, creations, packages and website
requests, without administrators' private notes.

## Operating it

- **Who answers requests, and within how many days:** to be decided by the owner. The software
  needs no human step for customers; business owners need an administrator within the pilot's
  chosen response time. Check **Admin → Deletions** at least every business day during the pilot.
- **After restoring a backup:** list the completed requests (`account_deletion_requests`) and
  delete those people again before reopening the site, then run the maintenance job.
- **Stuck request:** a request that stays "approved" past its date usually means the maintenance job
  is failing. Read the job's log in Render; the error names the step. The usual causes are a wrong
  `SUPABASE_SERVICE_ROLE_KEY` or storage being unreachable.
- **Administrators** cannot delete their own account from the app; the owner removes them directly
  after granting someone else access.
