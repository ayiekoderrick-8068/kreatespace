import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { disconnectPrisma, getPrisma } from "../../apps/api/src/lib/prisma.ts";
import { PASSWORD, newActor, uniqueTag } from "../support/actors.ts";
import { DATABASE_URL } from "../support/env.ts";
import { TEST_TOTP_CODE, userIdFor } from "../support/supabase-mock.ts";

test.afterAll(async () => {
  await disconnectPrisma();
});

async function newAdmin() {
  const email = `admin-${uniqueTag()}@kreatespace.test`;
  await getPrisma(DATABASE_URL).user.create({
    data: { id: userIdFor(email), email, role: "ADMIN", fullName: "Second Admin" },
  });
  return email;
}

async function passwordLogin(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** What the server says to this browser's current session when it asks for admin data. */
async function adminApiStatus(page: Page): Promise<{ status: number; code?: string }> {
  return page.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"))!;
    const token = JSON.parse(localStorage.getItem(key)!).access_token as string;
    const response = await fetch("/api/admin/analytics", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, code: body?.error?.code };
  });
}

const gateOf = (page: Page) => page.getByRole("region", { name: "Two-step verification" });

test("a first-time administrator must set up an authenticator before the admin area opens", async ({
  browser,
}) => {
  const email = await newAdmin();
  const page = await newActor(browser);
  await passwordLogin(page, email);
  await page.goto("/admin/analytics");

  const gate = gateOf(page);
  await expect(gate).toBeVisible();
  await expect(gate.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expect(gate.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  // Nothing from the admin area is shown, and the server refuses it too.
  await expect(page.getByRole("heading", { name: "Platform analytics" })).toHaveCount(0);
  expect(await adminApiStatus(page)).toEqual({ status: 403, code: "MFA_REQUIRED" });

  // A wrong code is explained and changes nothing.
  await gate.getByLabel("6-digit code").fill("000000");
  await gate.getByRole("button", { name: "Finish set-up" }).click();
  await expect(gate.getByText(/That code didn’t work/)).toBeVisible();
  expect(await adminApiStatus(page)).toEqual({ status: 403, code: "MFA_REQUIRED" });

  // The right code opens the area and the server now agrees.
  await gate.getByLabel("6-digit code").fill(TEST_TOTP_CODE);
  await gate.getByRole("button", { name: "Finish set-up" }).click();
  await expect(page.getByRole("heading", { name: "Platform analytics" })).toBeVisible();
  await expect(gate).toBeHidden();
  expect((await adminApiStatus(page)).status).toBe(200);
});

test("a returning administrator is asked for a code, not to set up again, and logging out keeps the area closed", async ({
  browser,
}) => {
  const email = await newAdmin();

  // First visit: set up.
  const first = await newActor(browser);
  await passwordLogin(first, email);
  await first.goto("/admin");
  await gateOf(first).getByLabel("6-digit code").fill(TEST_TOTP_CODE);
  await gateOf(first).getByRole("button", { name: "Finish set-up" }).click();
  await expect(gateOf(first)).toBeHidden();

  // Later, on another device: a password alone is not enough.
  const second = await newActor(browser);
  await passwordLogin(second, email);
  await second.goto("/admin/businesses");
  const gate = gateOf(second);
  await expect(gate).toBeVisible();
  await expect(gate.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  await expect(gate.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(second.getByRole("link", { name: "Packages" })).toBeVisible(); // navigation is visible…
  await expect(second.getByRole("heading", { name: /Business/ })).toHaveCount(0); // …the data is not.
  expect(await adminApiStatus(second)).toEqual({ status: 403, code: "MFA_REQUIRED" });

  await gate.getByLabel("6-digit code").fill(TEST_TOTP_CODE);
  await gate.getByRole("button", { name: "Continue" }).click();
  await expect(gate).toBeHidden();
  expect((await adminApiStatus(second)).status).toBe(200);

  // Logging out and back in with just the password closes it again.
  // The header's Log out button is hidden on phones, where it lives on the account page.
  if (test.info().project.use.isMobile) await second.goto("/account");
  await second.getByRole("button", { name: "Log out" }).first().click();
  await passwordLogin(second, email);
  await second.goto("/admin/businesses");
  await expect(gateOf(second)).toBeVisible();
  expect(await adminApiStatus(second)).toEqual({ status: 403, code: "MFA_REQUIRED" });
});

test("the screen can be completed with the keyboard alone", async ({ browser }) => {
  const email = await newAdmin();
  const page = await newActor(browser);
  await passwordLogin(page, email);
  await page.goto("/admin");
  const gate = gateOf(page);
  await expect(gate).toBeVisible();

  // The code box already has focus, so typing and pressing Enter is enough.
  await expect(gate.getByLabel("6-digit code")).toBeFocused();
  await page.keyboard.type(TEST_TOTP_CODE);
  await page.keyboard.press("Enter");
  await expect(gate).toBeHidden();
});

test("customers and sellers never see the second-step screen", async ({ browser }) => {
  const page = await newActor(browser);
  const email = `customer-${uniqueTag()}@example.com`;
  await passwordLogin(page, email);
  await page.goto("/admin");
  // A customer is turned away from the admin area altogether; no screen offering to set anything up.
  await expect(gateOf(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Administration" })).toHaveCount(0);
});

test("the set-up and code screens have no automated accessibility violations", async ({
  browser,
}) => {
  const email = await newAdmin();
  const check = async (page: Page, what: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        rule: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
      what,
    ).toEqual([]);
  };

  const first = await newActor(browser);
  await passwordLogin(first, email);
  await first.goto("/admin");
  await expect(gateOf(first).getByRole("img", { name: /QR code/ })).toBeVisible();
  await check(first, "first-time set-up screen");
  await gateOf(first).getByLabel("6-digit code").fill(TEST_TOTP_CODE);
  await gateOf(first).getByRole("button", { name: "Finish set-up" }).click();
  await expect(gateOf(first)).toBeHidden();

  const second = await newActor(browser);
  await passwordLogin(second, email);
  await second.goto("/admin");
  await expect(gateOf(second).getByRole("button", { name: "Continue" })).toBeVisible();
  await check(second, "code entry screen");
});
