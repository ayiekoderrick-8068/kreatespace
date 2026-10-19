# What personal data KreateSpace handles

This is a factual inventory of what the software stores and shares, written from the code and the
database schema, for whoever prepares the privacy policy and terms. **It is not legal advice and
does not replace them.** Anything the hosting providers collect on their own (access logs, for
example) is listed from general knowledge of how those services behave and should be confirmed in
their documents.

## Data the application stores

| Data                                                                                                                         | Whose                                                                                       | Where                                                                       | Purpose                                               | Visible to                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Email address, password (as a hash), name                                                                                    | Everyone with an account                                                                    | Supabase Auth, plus `users` table (email, name, role)                       | Sign-in, contact, roles                               | The person; administrators see email and name of sellers they review                                                            |
| Seller invitation (email, hashed token, status, dates)                                                                       | Invited business owners                                                                     | `invitations`                                                               | Controls who may register a business during the pilot | Administrators                                                                                                                  |
| Business profile: business name, owner name, description, category, county, city, website, **WhatsApp number**, logo, photos | Sellers                                                                                     | `businesses`, `business_revisions`, `business_images`, Storage              | Public business page and discovery                    | The WhatsApp number is used to build the "Enquire on WhatsApp" link on public pages, so treat it as **published** once approved |
| Terms and content-ownership confirmations (timestamps)                                                                       | Sellers                                                                                     | `business_revisions`                                                        | Record that the seller agreed                         | Administrators                                                                                                                  |
| Creations, packages, photos                                                                                                  | Sellers                                                                                     | `creations`, `creation_*`, `service_packages`, Storage                      | Public portfolio                                      | Public once approved; drafts and pending items are private                                                                      |
| Moderation decisions and reasons                                                                                             | Sellers' content                                                                            | `review_decisions`, `creation_review_decisions`, `package_review_decisions` | Feedback to sellers                                   | The seller and administrators                                                                                                   |
| Saved creations                                                                                                              | Customers                                                                                   | `saved_creations` (account-linked)                                          | The customer's saved list                             | The customer                                                                                                                    |
| Website help requests (description, budget, timeline, replies, private notes)                                                | Sellers                                                                                     | `website_requests`                                                          | Handling the request                                  | The seller (not the private notes) and administrators                                                                           |
| Website import records (authorised domain, pages found, outcome)                                                             | Sellers (their own website)                                                                 | `import_*`                                                                  | Importing a seller's own content with permission      | Administrators                                                                                                                  |
| Audit log (who did what to which record, and when)                                                                           | Administrators and sellers                                                                  | `audit_logs`                                                                | Accountability                                        | Administrators (database access)                                                                                                |
| Analytics events (type, business, creation, source, time)                                                                    | **Nobody**: no account, IP address, browser details, message text or phone number is stored | `inquiry_events`                                                            | Seller analytics                                      | The business sees counts only; deleted after 13 months                                                                          |

**WhatsApp messages never pass through KreateSpace.** The site builds a link containing a prepared
message (creation title, optional quote details the customer typed) and the customer's WhatsApp
app sends it. The quote form's contents are not stored. A click records only that the link was
opened.

## Data held in the visitor's browser

| Item                                   | Purpose                                         | Cleared    |
| -------------------------------------- | ----------------------------------------------- | ---------- |
| Sign-in session (Supabase)             | Stay signed in                                  | On log out |
| Pending seller invitation token        | Finish accepting an invitation after signing in | After use  |
| Pending "save" (creation id and title) | Finish a save after logging in                  | After use  |

No advertising or analytics cookies are set by KreateSpace. Confirm this stays true if a third-party
analytics tool is added later.

## Data held by providers

- **Supabase** (database, Auth, Storage): all of the above; Auth also keeps sign-in metadata such as
  IP addresses and timestamps in its own logs.
- **Vercel / Render**: request logs (IP address, URL, time, browser string) for operating the sites.
  Invitation links contain a one-time token in the address; keep access to logs limited.
- **Email provider** (to be chosen): the content and recipients of verification and reset emails.
- **Google** (only if Google sign-in is switched on): Google receives the sign-in request.

Check where each provider stores data and whether it is outside Kenya; that matters for the
cross-border transfer rules in the Data Protection Act, 2019.

## Questions the policy and process need to answer

1. Who is the data controller, and is KreateSpace registered with the Office of the Data Protection
   Commissioner as the law requires for its size and activities?
2. What is the lawful basis for each item above, and what exactly do sellers consent to when they
   publish a WhatsApp number and business details?
3. How long is each item kept, and how is an account deleted? Today there is **no self-service
   deletion**: it needs an administrator and database access. Write the procedure (what is deleted,
   what is kept for the audit trail, within how many days) before launch.
4. How do people ask for their data, and who answers?
5. What happens when content is reported (takedown), and who decides?
6. Are customers under 18 allowed to register?
