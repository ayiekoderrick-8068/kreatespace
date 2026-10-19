# Pilot launch checklist

KreateSpace will start with about 15 invited creative businesses. Work through this list in order.
Items marked **BLOCKER** must be done before any real business or customer uses the site. Tick a box
only when you have seen it work yourself, not because a document says it should.

## 0. Blockers

- [ ] **BLOCKER: legal review of terms and privacy.** The site now has terms, seller terms and a
      privacy policy at `/terms`, `/seller-terms` and `/privacy`, linked from sign-up, the seller
      wizard and the footer, and acceptance is recorded. They are **engineering drafts**: have them
      reviewed by a lawyer who knows Kenyan law (start from `docs/DATA_INVENTORY.md`) and change the
      text and version before launch.
- [ ] **BLOCKER: Data Protection Act.** Confirm with a lawyer whether KreateSpace must register with
      the Office of the Data Protection Commissioner and what notices it owes people.
- [ ] **BLOCKER: decide the deletion and data-request process.** Self-service account deletion and
      data export now exist (`docs/ACCOUNT_DELETION.md`). Still needed from you: a named person
      who checks **Admin → Deletions** for business owners' requests, the response time, and the
      lawyer's answer on what must be kept and for how long.
- [ ] **BLOCKER: backups.** Confirm what Supabase backs up on your plan, set up your own dumps and
      photo copies, and run `scripts/restore-drill.sh` against a real backup (`docs/OPERATIONS.md`).
- [ ] **BLOCKER: real email.** Configure your own SMTP provider in Supabase and test verification and
      password-reset emails to mailboxes at several providers (including Gmail and Safaricom/Yahoo).
- [ ] **BLOCKER: production configuration.** Complete `docs/DEPLOYMENT.md`, including replacing
      `__API_ORIGIN__` in `apps/web/vercel.json`, and the "Before you go live" list.
- [ ] Decide who is on call during the pilot and how they are alerted (`docs/OPERATIONS.md`).

## 1. Accounts and roles

- [ ] The first administrator exists (`admin:grant`); a second administrator exists as a backup.
- [ ] Administrators use strong, unique passwords. Two-step verification (an authenticator app) is
      enforced by the server for every administrator route; each administrator sets it up on first
      use. Keep `ADMIN_MFA_REQUIRED` at its default (`true`) in production, and see `docs/OPERATIONS.md`
      for resetting a lost authenticator (`admin:reset-mfa`).
- [ ] A customer account cannot reach `/seller` or `/admin` (try it).

## 2. Seller invitations

- [ ] Invite every pilot business from **Admin → Invitations**; share each link privately (it is shown
      once and expires after 14 days).
- [ ] A seller opens their link, signs up or logs in with the **same email**, and sees the
      registration form. An old, used or revoked link gives a clear message.
- [ ] A different email cannot use someone else's invitation.

## 3. Business approval

- [ ] Each seller completes registration (details, photos, terms, content-ownership) and submits.
- [ ] Administrators review each application, approve or ask for changes with a clear reason, and the
      seller sees that feedback on their dashboard.
- [ ] After approval the public business page shows exactly the approved details; later edits stay
      hidden until approved.

## 4. Creations

- [ ] Sellers add creations with up to 5 photos each, save drafts, and submit them. The 20-creation
      limit is explained clearly when reached.
- [ ] Administrators approve or reject each creation with a reason. Approved creations appear in the
      gallery; edits to a live creation stay private until approved.
- [ ] Optional service packages work and are reviewed before they appear.

## 5. Discovery (as a customer, logged out, on a phone)

- [ ] Home page loads quickly on mobile data and shows real content, not placeholders.
- [ ] Search finds a product and a service; filters for category, occasion, county and city combine.
- [ ] Creation page, business page and the business's website link open correctly.
- [ ] **Enquire on WhatsApp** opens a chat with the **correct business** and a message naming the
      right creation. (Test with each pilot business's own number. No message is sent for you.)
- [ ] Sign up, log in, log out, forgot password, saved creations all work.
- [ ] No fictional businesses, products, ratings or statistics anywhere. Check that no
      "Dev Fixture" content exists: `seed:dev` refuses to run in production, but look anyway.

## 6. Seller extras

- [ ] Analytics show real, plausible numbers after a day of use, and the page explains that a
      WhatsApp click is not a sent message.
- [ ] "Website help" requests reach the admin queue and replies reach the seller.
- [ ] If any seller asks for their website to be imported: grant the authorisation, run it, review
      every page, and confirm imported items are drafts the seller must still submit.

## 7. Search engines and sharing

- [ ] `/sitemap.xml` and `/robots.txt` load on the live domain; private areas are disallowed.
- [ ] Submit the sitemap in Google Search Console and Bing Webmaster Tools.
- [ ] A creation and a business link pasted into WhatsApp show a preview with title and photo.

## 8. Feedback and measuring the pilot

- [ ] Choose one channel (a WhatsApp group for sellers works well in Kenya) and tell sellers where to
      report problems.
- [ ] Ask each seller after week one: could you register without help? Did approval take too long?
      Did customers contact you? What confused you?
- [ ] Ask a few customers: could you find what you wanted? Was contacting the business easy?
- [ ] Track weekly: sellers active, creations approved, time to approve, page views, WhatsApp link
      clicks per business (from the analytics pages), and problems reported.
- [ ] Decide in advance what "success" means (for example, most sellers publish at least five
      creations and receive WhatsApp clicks within a month).

## 9. Known limits to tell the pilot sellers

- Invitation links are shared by hand; there is no invitation email yet.
- Deleting an account waits 14 days, and a business owner's request also waits for an
  administrator. Deletion happens in the daily clean-up, not instantly.
- WhatsApp clicks measure the link being opened, not messages sent or sales.
- Prices are shown only when a seller chooses to add one to a package.
