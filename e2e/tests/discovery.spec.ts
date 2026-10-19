import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, logIn, newActor, uniqueTag } from "../support/actors.ts";
import { closeDatabase, seedCatalogue } from "../support/data.ts";

test.afterAll(async () => {
  await closeDatabase();
});

const isPhone = () => Boolean(test.info().project.use.isMobile);

test("a visitor can discover, filter, open a creation and reach the business — without an account", async ({
  browser,
}) => {
  const tag = uniqueTag();
  const catalogue = await seedCatalogue(tag);
  const page = await newActor(browser);

  // --- Home: the proposition, search and real content -------------------------------------
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Discover creativity\.\s*Meet the creator\./ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Browse by category" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recently published" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How KreateSpace works" })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expectNoHorizontalScroll(page);

  if (isPhone()) {
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  } else {
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeHidden();
  }

  // --- Search from the hero ----------------------------------------------------------------
  await page.getByRole("searchbox", { name: "Search creations" }).fill(`wedding zq${tag}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/explore\?q=wedding/);
  await expect(page.getByRole("link", { name: `Wedding cake zq${tag}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Bridal makeup zq${tag}` })).toBeVisible();
  // Not a match for "wedding": the birthday cake from the same bakery.
  await expect(page.getByRole("link", { name: `Birthday cake zq${tag}` })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // --- Filters combine, and the URL records them -------------------------------------------
  await page.goto(`/explore?q=zq${tag}`);
  await expect(page.getByRole("link", { name: `Birthday cake zq${tag}` })).toBeVisible();
  if (isPhone()) await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByLabel("County").selectOption("Kisumu");
  await expect(page.getByRole("link", { name: `Bridal makeup zq${tag}` })).toHaveCount(0);
  await page.getByLabel("City or town").selectOption("Milimani");
  await page.getByLabel("Occasion", { exact: true }).selectOption("wedding");
  await expect(page.getByRole("link", { name: `Birthday cake zq${tag}` })).toHaveCount(0);
  await expect(page.getByRole("link", { name: `Wedding cake zq${tag}` })).toBeVisible();
  await expect(page).toHaveURL(/county=Kisumu/);
  await expect(page).toHaveURL(/city=Milimani/);
  await expect(page).toHaveURL(/occasion=wedding/);

  // A shared link reproduces the same results in a fresh browser.
  const shared = page.url();
  const friend = await newActor(browser);
  await friend.goto(shared);
  await expect(friend.getByRole("link", { name: `Wedding cake zq${tag}` })).toBeVisible();
  await expect(friend.getByLabel("County")).toHaveValue("Kisumu");

  // No results shows a way out.
  await page.getByRole("searchbox").fill("submarine");
  await expect(page.getByText("No creations match your search")).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters" }).click();
  await expect(page).toHaveURL(/\/explore$/);

  // --- Creation detail ----------------------------------------------------------------------
  await page.goto(`/explore?q=zq${tag}&category=cakes`);
  await page.getByRole("link", { name: `Wedding cake zq${tag}` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Wedding cake zq${tag}` }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Wedding", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show photo 2 of 2" })).toBeVisible();
  const about = page.getByRole("region", { name: "About the business" });
  await expect(about.getByRole("link", { name: catalogue.kisumuBakery.name })).toBeVisible();
  await expect(about.getByText("Milimani, Kisumu")).toBeVisible();
  await expect(about.getByRole("link", { name: "Enquire on WhatsApp" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/254712345678\?text=/,
  );
  await expect(about.getByRole("link", { name: "Visit website" })).toHaveAttribute(
    "href",
    "https://example.com",
  );
  const photo = page.getByAltText(`Wedding cake zq${tag} by ${catalogue.kisumuBakery.name}`);
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth > 0))
    .toBe(true);
  await expectNoHorizontalScroll(page);

  // Related creations: same category / occasion, and never itself.
  const related = page.getByRole("region", { name: "You might also like" });
  await expect(related.getByRole("link", { name: `Birthday cake zq${tag}` })).toBeVisible();
  await expect(related.getByRole("link", { name: `Wedding cake zq${tag}` })).toHaveCount(0);

  // --- From creation to the business's profile ------------------------------------------------
  await about.getByRole("link", { name: catalogue.kisumuBakery.name }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: catalogue.kisumuBakery.name }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Message on WhatsApp" })).toBeVisible();
  const theirWork = page.getByRole("heading", { name: "Their work" }).locator("..");
  await expect(theirWork.getByRole("link", { name: `Wedding cake zq${tag}` })).toBeVisible();
  await expect(theirWork.getByRole("link", { name: `Birthday cake zq${tag}` })).toBeVisible();
  await expect(theirWork.getByRole("link", { name: `Bridal makeup zq${tag}` })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("unapproved and suspended content never reaches the public", async ({ browser }) => {
  const tag = uniqueTag();
  const catalogue = await seedCatalogue(tag);
  const page = await newActor(browser);

  // Search finds the approved items but not the hidden ones that share the same word.
  await page.goto(`/explore?q=secret zq${tag}`);
  await expect(page.getByText("No creations match your search")).toBeVisible();
  await page.goto(`/explore?q=zq${tag}`);
  await expect(page.getByRole("link", { name: `Wedding cake zq${tag}` })).toBeVisible();
  await expect(page.getByRole("link", { name: /Secret/ })).toHaveCount(0);

  // Direct links do not leak them either.
  for (const id of [catalogue.hidden.pendingId, catalogue.hidden.suspendedId]) {
    await page.goto(`/creations/${id}`);
    await expect(page.getByRole("heading", { name: "Creation not found" })).toBeVisible();
  }
  await page.goto(`/businesses/suspended-${tag}`);
  await expect(page.getByRole("heading", { name: "Business not found" })).toBeVisible();
});

test("saving needs a login, remembers the creation, and finishes after logging in", async ({
  browser,
}) => {
  const tag = uniqueTag();
  const email = `fan-${tag}@example.com`;
  await seedCatalogue(tag);
  const page = await newActor(browser);

  await page.goto(`/explore?q=zq${tag}`);
  const title = `Wedding cake zq${tag}`;
  await page.getByRole("button", { name: `Save “${title}”` }).click();
  const invitation = page.getByRole("dialog", { name: "Save it for later" });
  await expect(invitation).toBeVisible();
  await invitation.getByRole("link", { name: "Log in" }).click();
  await logIn(page, email);

  // Back where they were, with the save completed.
  await expect(page).toHaveURL(new RegExp(`/explore\\?q=zq${tag}`));
  await expect(page.getByText(`Saved “${title}” to your list.`)).toBeVisible();
  await expect(page.getByRole("button", { name: `Remove “${title}” from saved` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // It's in their saved list.
  await page.goto("/saved");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Removing it empties the list.
  await page.getByRole("button", { name: `Remove “${title}” from saved` }).click();
  await expect(page.getByText("Nothing saved yet")).toBeVisible();
});

test("the gallery uses columns that suit the screen", async ({ browser }) => {
  const tag = uniqueTag();
  await seedCatalogue(tag);
  const page = await newActor(browser);
  await page.goto(`/explore?q=zq${tag}`);
  await expect(page.getByRole("link", { name: `Wedding cake zq${tag}` })).toBeVisible();

  const count = await page
    .locator("main ul.columns-2")
    .first()
    .evaluate((el) => Number(getComputedStyle(el).columnCount));
  if (isPhone()) expect(count).toBe(2);
  else expect(count).toBeGreaterThanOrEqual(4);
});
