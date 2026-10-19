import { expect, test, type Page } from "@playwright/test";
import { closeDatabase } from "../support/data.ts";
import { ADMIN_EMAIL, seedSite, signedIn, type SiteFixture } from "../support/site.ts";

test.afterAll(async () => {
  await closeDatabase();
});

// Every size is checked once, whichever device profile runs the file.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop", "Sizes are set inside the test");
});

/** Representative screens: small and large Android phones, an iPhone, a tablet, a laptop and a monitor. */
const SIZES = [
  { name: "small Android phone", width: 320, height: 640 },
  { name: "Android phone", width: 360, height: 780 },
  { name: "iPhone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "desktop monitor", width: 1920, height: 1080 },
] as const;

/** Elements poking out past the right edge of the screen, with a short description of each. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const found: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= limit + 1 && rect.left >= -1) continue;
      // Content inside a deliberately scrollable box (a wide table) is allowed to extend.
      let scrollable = false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") scrollable = true;
      }
      if (scrollable) continue;
      if (getComputedStyle(el).position === "fixed" && rect.right > limit) {
        found.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
        continue;
      }
      found.push(
        `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${Math.round(rect.left)}→${Math.round(rect.right)} of ${limit})`,
      );
    }
    return found.slice(0, 5);
  });
}

async function checkPage(page: Page, size: (typeof SIZES)[number], name: string, path: string) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(path);
  await expect(page.locator("main, h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const scrollsSideways = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  const offenders = await overflowing(page);
  expect(
    { scrollsSideways, offenders },
    `${name} (${path}) at ${size.width}px wide on a ${size.name}`,
  ).toEqual({ scrollsSideways: false, offenders: [] });
}

let site: SiteFixture;

test.describe.configure({ mode: "serial" });

test("public pages fit every screen size", async ({ browser }) => {
  test.setTimeout(240_000);
  site = await seedSite(browser);
  const context = await browser.newContext();
  const page = await context.newPage();
  const { mockSupabase } = await import("../support/supabase-mock.ts");
  await mockSupabase(context);
  for (const size of SIZES) {
    for (const [name, path] of site.publicPages) await checkPage(page, size, name, path);
  }
});

test("seller pages fit every screen size", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await signedIn(browser, site.sellerEmail);
  for (const size of SIZES) {
    for (const [name, path] of site.sellerPages) await checkPage(page, size, name, path);
  }
});

test("admin pages fit every screen size", async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await signedIn(browser, ADMIN_EMAIL);
  for (const size of SIZES) {
    for (const [name, path] of site.adminPages) await checkPage(page, size, name, path);
  }
});
