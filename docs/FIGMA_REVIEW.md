# Comparing the website with the Figma design

**Status: not done. No visual comparison has been made, and none of the screens below can be
described as matching the design.** The Figma file
(`figma.com/design/jR2yzu7vqkCKcqYxDDk0eZ`) cannot be read from the tools available here: the page
is an empty JavaScript shell and no Figma integration is connected. Nothing was guessed.

## What is needed

For each screen below, one exported picture per device size, from the Figma frames:

- **Desktop** frame, exported as PNG at 1x (the website is checked at 1280 × 720).
- **Android** frame, exported at 1x (the tests use a Pixel 5: 393 × 851).
- **iPhone** frame, exported at 1x (the tests use an iPhone 13: 390 × 844).

In Figma: select the frame → Export (right-hand panel) → PNG, 1x → name it
`<screen>-<desktop|android|iphone>.png`. Put them in a folder and tell me where it is (or paste
them into the conversation). Alternatively, make the file viewable by a Figma access token and tell
me; I should not be given a token that can edit.

| Screen                | Website address                                   |
| --------------------- | ------------------------------------------------- |
| Homepage              | `/`                                               |
| Discovery gallery     | `/explore` and `/explore?q=…`                     |
| Login                 | `/login`                                          |
| Sign up               | `/register`                                       |
| Forgot password       | `/forgot-password`                                |
| Creation details      | `/creations/<id>`                                 |
| Business profile      | `/businesses/<slug>`                              |
| Seller dashboard      | `/seller`                                         |
| Seller profile editor | `/seller/edit`                                    |
| Creation editor       | `/seller/creations/new`                           |
| Service packages      | `/seller/packages` and the public package section |
| WhatsApp inquiry      | the "Enquire on WhatsApp" button and quote form   |
| Seller analytics      | `/seller/analytics`                               |
| Website requests      | `/seller/website`, `/admin/website-requests`      |
| Website importer      | `/admin/imports`                                  |
| Admin dashboard       | `/admin/businesses` and the other admin tabs      |

The account page with account deletion (`/account`) and the admin Deletions tab were added after
the design and may have no frame; if they do not, they need one.

## Pictures of the running website, to hold next to the design

A capture script saves a full-page picture of every screen above at the same three sizes:

```bash
CAPTURE_SCREENS=1 pnpm --filter @kreatespace/e2e test:e2e screens.spec.ts
```

Pictures are written to `e2e/test-results/screens/<device>/<screen>.png` (device names are
`desktop`, `android-phone` and `iphone`). They show the development fixtures' plain placeholder
photos, so compare layout, spacing, type and colour, not the images. It needs the local database
and browsers set up as for the other browser tests.

## How the comparison will be done once the designs are available

1. Put the design picture and the website picture side by side for each screen and size.
2. List differences in layout, spacing, type size and weight, colour, icons and copy.
3. Fix each real difference in the smallest way, keeping behaviour, accessibility and tests intact.
4. Record what was compared and what was changed here, with the commit.
