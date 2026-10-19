# Performance

Everything here was measured on a development machine on 19 October 2026, not invented or
estimated. **It is not field data from real visitors:** there are none until the site is live. Treat
these numbers as a baseline to compare against, and re-measure on the live site.

## How the website was measured

- **Tool:** Lighthouse, mobile settings (a mid-range Android phone: 4× slower processor, simulated
  slow 4G), in Chrome for Testing 156.
- **Setup:** the production build, served with the real API and a real PostgreSQL database holding
  the development fixtures (4 businesses, 16 creations). Photos in the fixtures are tiny SVGs, so
  these figures do **not** include the cost of real photos (see "Photos" below).
- **Variance:** each page was measured once per round. Total blocking time moved by several hundred
  milliseconds between rounds on the same code (for example 541 to 1,966 ms on one page), so only
  large differences mean anything.

### Before and after

The first round was a true baseline for a production-like build. (An earlier build without the
sign-in settings accidentally dropped the sign-in library and looked better than reality.)

| Page             | Performance | LCP (s) | Blocking time (ms) | Layout shift | JavaScript (KB, compressed) |
| ---------------- | ----------: | ------: | -----------------: | -----------: | --------------------------: |
| Home, before     |          71 |     2.8 |              1,022 |        0.000 |                         219 |
| Home, after      |      **77** |     2.6 |            **590** |        0.000 |                     **155** |
| Explore, before  |          70 |     2.8 |              1,157 |        0.000 |                         219 |
| Explore, after   |      **74** |     2.6 |            **894** |        0.000 |                     **155** |
| Creation, before |          66 |     2.7 |              1,883 |        0.018 |                         219 |
| Creation, after  |      **78** |     2.7 |            **528** |        0.000 |                     **155** |
| Business, before |          48 |     2.6 |              1,089 |    **0.683** |                         219 |
| Business, after  |      **81** |     2.6 |            **541** |    **0.020** |                     **155** |

Accessibility scored 100 and best practices 96 on every page, before and after. SEO scored 92; the
missing points came from `robots.txt`, which the local preview server answers with the app instead
of the real file. Confirm this on the live site.

What changed it (`git log` has the details):

1. **The sign-in library (53 KB compressed) is fetched only when needed**: when the browser has a
   stored session or a sign-in redirect, or when someone signs in. Anonymous visitors never download
   it.
2. **Login, sign-up, password and account pages, and the quote form, load on demand**, which keeps the
   form and validation libraries off the home path.
3. **The business page reserves space while loading**, which removed a layout shift of 0.683 (the
   footer jumped down when content arrived).

Core Web Vitals reading: layout shift is now good (under 0.1). Largest contentful paint is about
2.6 s, just over the 2.5 s "good" line. Interaction responsiveness (INP) was not measured; blocking
time of 500–900 ms on this simulated phone says the page does a lot of work before it is responsive,
so expect it to be noticeably slower on low-end phones than on a laptop.

### Still to do for the website (not blocking the pilot)

- About 45 KB of the remaining JavaScript is validation code (zod) pulled in because public pages
  import a few constants from the shared package's single entry file, which also defines every form
  schema. Splitting constants from schemas inside `packages/shared` would remove it from the home path.
- Re-measure after the first real photos are live; photos will dominate page weight.

## Photos

Sellers upload photos from phones, up to 5 MB each, and the gallery shows two dozen tiles at a time.
Two measures keep this under control:

- **In the browser, before upload,** large photos are scaled to at most 1,600 px on the longer side
  and re-saved (checked in Chromium: a 4000×3000 JPEG went from 876 KB to 208 KB; an 8000×6000 photo of
  4.5 MB became 368 KB). Small photos are untouched.
- **Supabase image transformations** (a paid-plan feature) serve resized versions to each screen.
  Set `SUPABASE_IMAGE_TRANSFORMS=true` once your plan includes it; the website already requests
  several widths and lets the browser choose.

Photos already uploaded before this change are not resized. Gallery images load lazily and reserve
their space (width and height are stored), which is why layout shift is near zero.

## How the API was measured

`pnpm --filter @kreatespace/api benchmark` seeds a scratch database on this machine with a synthetic
catalogue (20 creations per business, 3 photos each, plus analytics events) and times each query 25
times after warming up. It refuses to run against anything that is not on localhost.

| Query                              | 300 creations (pilot size) | 5,000 creations | 20,000 creations |
| ---------------------------------- | -------------------------: | --------------: | ---------------: |
| Feed, first page                   |                      15 ms |           13 ms |            16 ms |
| Feed, page 50                      |                       5 ms |           18 ms |            25 ms |
| Filters (category + county)        |                       9 ms |           15 ms |            20 ms |
| Home page data                     |                      32 ms |           38 ms |           120 ms |
| Creation page                      |                       7 ms |            6 ms |             5 ms |
| Related creations                  |                      17 ms |           21 ms |            55 ms |
| Business page                      |                      12 ms |           13 ms |            16 ms |
| Seller analytics (90 days)         |                      29 ms |           30 ms |            31 ms |
| Sitemap                            |                       6 ms |           37 ms |           152 ms |
| **Search: a word ("cake")**        |                      45 ms |      **279 ms** |     **1,626 ms** |
| **Search: partial typing ("wed")** |                      38 ms |      **240 ms** |     **1,002 ms** |
| **Search: nothing matches**        |                      24 ms |      **196 ms** |       **882 ms** |

Median times; the 95th percentile is typically within about 2× of these. Events: 5,000 / 100,000 / 100,000.

### Reading the table

- **At pilot size (about 300 creations) everything answers in under 50 ms.**
- Browsing, filters, pages and analytics stay fast at 20,000 creations.
- **Search is the one that does not scale.** It builds the text-search document for every public
  creation on every query, so its time grows in step with the catalogue. It is comfortable up to a
  couple of thousand creations (roughly 100 ms), noticeable at 5,000, and slow at 20,000.
  **Plan to fix search before the catalogue passes about 2,000 creations:** keep a stored,
  indexed search document per creation (updated when a creation or its business is published) so a
  search no longer reads every row. This was measured, not implemented, because the pilot
  (15 businesses, at most 300 creations) is far below the threshold.

## Caching

- Public API responses (feed, home, filters, a creation) are cacheable for 30 s with
  stale-while-revalidate; search-engine pages for 5 minutes; the sitemap and robots file for an hour;
  preview images for a day. Pages with signed photo links are not cached for long, because those
  links expire after an hour.
- Built website files are named by content and cached for a year; `index.html` is always revalidated
  (`apps/web/vercel.json`).

## What was not measured

- Real phones and real mobile networks in Kenya.
- Field Core Web Vitals (needs live traffic; use the browser's CrUX data or Vercel analytics later).
- Behaviour under concurrent load (no load test was run; the pilot's traffic is small).
- Supabase Storage and database latency from the chosen region.
