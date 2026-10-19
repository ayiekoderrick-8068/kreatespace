import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { closeDatabase } from "../support/data.ts";
import { ADMIN_EMAIL, seedSite, signedIn, type SiteFixture } from "../support/site.ts";

test.afterAll(async () => {
  await closeDatabase();
});

test.describe.configure({ mode: "serial" });

let site: SiteFixture;

/** Automated WCAG 2.0/2.1 A and AA checks. Colour contrast is included. */
async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  return results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
}

async function audit(page: Page, name: string, path: string) {
  await page.goto(path);
  await expect(page.locator("main, h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await violations(page), `${name} (${path})`).toEqual([]);
}

test("public pages have no automated accessibility violations", async ({ browser }) => {
  test.setTimeout(180_000);
  site = await seedSite(browser);
  const context = await browser.newContext({
    ...test.info().project.use,
  });
  const { mockSupabase } = await import("../support/supabase-mock.ts");
  await mockSupabase(context);
  const page = await context.newPage();
  for (const [name, path] of site.publicPages) await audit(page, name, path);
});

test("seller pages have no automated accessibility violations", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await signedIn(browser, site.sellerEmail);
  for (const [name, path] of site.sellerPages) await audit(page, name, path);
});

test("admin pages have no automated accessibility violations", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await signedIn(browser, ADMIN_EMAIL);
  for (const [name, path] of site.adminPages) await audit(page, name, path);
});
