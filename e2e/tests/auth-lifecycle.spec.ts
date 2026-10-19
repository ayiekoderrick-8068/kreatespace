import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { API_URL } from "../support/env.ts";
import { PASSWORD, expectNoHorizontalScroll, newActor, uniqueTag } from "../support/actors.ts";
import { accessTokenFor, authRequests } from "../support/supabase-mock.ts";

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  return results.violations.map((v) => ({
    rule: v.id,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
}

async function fillRegistration(page: Page, email: string, overrides: { confirm?: string } = {}) {
  await page.getByLabel("Full name").fill("Wanjiru Kamau");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(overrides.confirm ?? PASSWORD);
}

test.describe("creating an account", () => {
  test("each mistake is explained, the terms must be accepted, and acceptance is recorded with the account", async ({
    browser,
  }) => {
    const email = `new-${uniqueTag()}@example.com`;
    const page = await newActor(browser);
    await page.goto("/register");
    await expectNoHorizontalScroll(page);
    expect(await violations(page), "register page").toEqual([]);

    // Nothing filled in.
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your full name")).toBeVisible();
    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible();
    await expect(page.getByText(/Please accept the Terms of Use and Privacy Policy/)).toBeVisible();
    expect(await violations(page), "register page with errors").toEqual([]);

    // Passwords that differ.
    await fillRegistration(page, email, { confirm: "different123" });
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Passwords do not match")).toBeVisible();
    expect(authRequests.signups.some((s) => (s as { email: string }).email === email)).toBe(false);

    // The documents the person agrees to can be read first.
    const terms = page.getByRole("link", { name: "Terms of Use" });
    const privacy = page.getByRole("link", { name: "Privacy Policy" });
    await expect(terms).toHaveAttribute("href", "/terms");
    await expect(privacy).toHaveAttribute("href", "/privacy");
    await expect(terms).toHaveAttribute("target", "_blank");

    // Correct details: the account is created but must be verified before anyone can log in.
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to log in" })).toBeVisible();

    // What the sign-in service was sent: the terms version and the time they were accepted.
    const sent = authRequests.signups.find((s) => (s as { email: string }).email === email) as {
      data: { full_name: string; terms_version: string; terms_accepted_at: string };
    };
    expect(sent.data.full_name).toBe("Wanjiru Kamau");
    expect(sent.data.terms_version).toMatch(/^draft-/);
    expect(Math.abs(Date.now() - Date.parse(sent.data.terms_accepted_at))).toBeLessThan(60_000);
  });

  test("an address that already has an account sees exactly what a new person sees", async ({
    browser,
  }) => {
    const page = await newActor(browser);
    await page.goto("/register");
    await fillRegistration(page, `existing-${uniqueTag()}@example.com`);
    await page.getByRole("checkbox", { name: /I have read and agree/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();
    // No "already registered" message: nobody can use this form to find out who has an account.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText(/already registered/i)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("the terms and privacy pages open", async ({ browser }) => {
    const page = await newActor(browser);
    for (const [path, heading] of [
      ["/terms", /Terms of Use/],
      ["/privacy", /Privacy Policy/],
      ["/seller-terms", /Seller Terms/],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });
});

test.describe("logging in and out", () => {
  test("a wrong password gets the one safe message, then the right one lets the person in and out", async ({
    browser,
  }) => {
    const email = `login-${uniqueTag()}@example.com`;
    const page = await newActor(browser);
    await page.goto("/login");
    expect(await violations(page), "login page").toEqual([]);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid login credentials");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email")).toHaveValue(email); // typed details are kept
    expect(await violations(page), "login page with an error").toEqual([]);

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).not.toHaveURL(/\/login/);

    await page.goto("/account");
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText("Customer", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).last().click();
    // Logging out leaves the private page, which sends a logged-out visitor to log in.
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a private page sends a logged-out visitor to log in and brings them back afterwards", async ({
    browser,
  }) => {
    const page = await newActor(browser);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill(`return-${uniqueTag()}@example.com`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  });

  test("logging in works from the keyboard alone", async ({ browser }) => {
    const page = await newActor(browser);
    await page.goto("/login");
    await page.getByLabel("Email").focus();
    await page.keyboard.type(`keys-${uniqueTag()}@example.com`);
    await page.keyboard.press("Tab");
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(/\/login/);
  });
});

test.describe("forgotten passwords", () => {
  test("the page says the same thing whether or not the address has an account, and asks for a link back to the site", async ({
    browser,
  }) => {
    const page = await newActor(browser);
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expectNoHorizontalScroll(page);
    expect(await violations(page), "forgot password page").toEqual([]);

    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Email is required")).toBeVisible();

    const email = `forgot-${uniqueTag()}@example.com`;
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "If an account exists for that email, a reset link is on its way.",
    );
    const asked = authRequests.recoveries.find((r) => (r as { email: string }).email === email) as {
      redirectTo: string;
    };
    expect(asked.redirectTo).toMatch(/\/reset-password$/);
    await expect(page.getByRole("link", { name: "Back to log in" })).toBeVisible();
  });
});

test.describe("who may see what", () => {
  test("a customer is turned away from seller and administrator pages, and the API agrees", async ({
    browser,
  }) => {
    const email = `curious-${uniqueTag()}@example.com`;
    const page = await newActor(browser);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).not.toHaveURL(/\/login/);

    await page.goto("/seller");
    await expect(
      page.getByRole("heading", { name: "You don’t have access to this page" }),
    ).toBeVisible();
    await page.goto("/admin/businesses");
    await expect(
      page.getByRole("heading", { name: "You don’t have access to this page" }),
    ).toBeVisible();
    await expect(page.getByText("This area is for KreateSpace administrators.")).toBeVisible();

    const token = await accessTokenFor(email);
    for (const path of ["/api/admin/businesses", "/api/admin/deletions", "/api/businesses/me"]) {
      const response = await page.request.get(`${API_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status(), path).toBe(403);
    }
  });

  test("the API refuses people who are not signed in, or whose token is invalid", async ({
    browser,
  }) => {
    const page = await newActor(browser);
    for (const path of ["/api/me", "/api/me/saved", "/api/me/deletion", "/api/admin/businesses"]) {
      expect((await page.request.get(`${API_URL}${path}`)).status(), path).toBe(401);
      const bad = await page.request.get(`${API_URL}${path}`, {
        headers: { Authorization: "Bearer not-a-real-token" },
      });
      expect(bad.status(), `${path} with a bad token`).toBe(401);
    }
  });
});
