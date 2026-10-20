import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { closeDatabase } from "../support/data.ts";
import { ADMIN_EMAIL, seedSite, signedIn } from "../support/site.ts";
import { newActor } from "../support/actors.ts";

// Saves a picture of every main screen at each device size, for putting next to the Figma design.
// It checks nothing, so it only runs when asked:
//
//   CAPTURE_SCREENS=1 pnpm --filter @kreatespace/e2e test:e2e screens.spec.ts
//
// Pictures go to e2e/test-results/screens/<device>/<screen>.png. The pages hold the development
// fixtures' plain placeholder photos, so compare layout, spacing, type and colour, not the images.
test.skip(!process.env.CAPTURE_SCREENS, "Set CAPTURE_SCREENS=1 to save screen pictures");
test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDatabase();
});

const fileName = (name: string) => name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

test("saves a picture of every screen at this device size", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const device = info.project.name;
  const folder = `test-results/screens/${device}`;
  mkdirSync(folder, { recursive: true });

  const site = await seedSite(browser);
  const snap = async (page: Page, name: string, path: string) => {
    await page.goto(path);
    await expect(page.locator("main, h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${folder}/${fileName(name)}.png`, fullPage: true });
  };

  const visitor = await newActor(browser);
  for (const [name, path] of site.publicPages) await snap(visitor, name, path);

  const seller = await signedIn(browser, site.sellerEmail);
  for (const [name, path] of site.sellerPages) await snap(seller, name, path);

  const admin = await signedIn(browser, ADMIN_EMAIL);
  for (const [name, path] of site.adminPages) await snap(admin, name, path);
});
