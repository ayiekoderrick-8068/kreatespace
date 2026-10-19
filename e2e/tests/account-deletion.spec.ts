import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { processAccountDeletions } from "../../apps/api/src/accounts/deletion.ts";
import { disconnectPrisma, getPrisma } from "../../apps/api/src/lib/prisma.ts";
import {
  expectNoHorizontalScroll,
  logIn,
  newActor,
  seedApprovedBusiness,
  uniqueTag,
} from "../support/actors.ts";
import { ADMIN_EMAIL, API_URL, DATABASE_URL } from "../support/env.ts";
import { accessTokenFor } from "../support/supabase-mock.ts";

test.afterAll(async () => {
  await disconnectPrisma();
});

const prisma = () => getPrisma(DATABASE_URL);

/** Stands in for Supabase's admin API and the photo store while the daily clean-up runs. */
const cleanupDeps = (now: Date) => ({
  now,
  storage: { removeFolder: async () => 0 } as never,
  authAdmin: { deleteUser: async () => undefined },
});
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

async function signIn(browser: Parameters<typeof newActor>[0], email: string) {
  const page = await newActor(browser);
  await page.goto("/login");
  await logIn(page, email);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  return page;
}

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  return results.violations.map((v) => ({
    rule: v.id,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
}

test("a customer asks to delete their account, sees it is only a request, can cancel, and asks again", async ({
  browser,
}) => {
  const email = `customer-${uniqueTag()}@example.com`;
  const page = await signIn(browser, email);

  await page.getByRole("button", { name: "Delete my account…" }).click();
  const form = page.getByRole("form", { name: "Delete your account" });
  await expect(form).toBeVisible();
  await expect(form.getByText(/permanently deleted/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(await violations(page), "open deletion form").toEqual([]);

  // Nothing is sent until the person says they understand.
  await expect(form.getByRole("button", { name: "Request account deletion" })).toBeDisabled();
  await form.getByRole("checkbox", { name: /I understand/ }).check();
  await form.getByRole("button", { name: "Request account deletion" }).click();

  await expect(page.getByText("Your account is scheduled for deletion")).toBeVisible();
  await expect(page.getByText("Nothing has been deleted yet.")).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(await violations(page), "pending deletion status").toEqual([]);
  expect(await prisma().user.count({ where: { email } })).toBe(1);

  // A reload keeps showing the same status.
  await page.reload();
  await expect(page.getByText("Your account is scheduled for deletion")).toBeVisible();

  // Changing their mind leaves the account untouched.
  await page.getByRole("button", { name: /Keep my account/ }).click();
  await expect(page.getByText(/Your request was cancelled/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete my account…" })).toBeVisible();

  // …and they can ask again.
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await page.getByRole("checkbox", { name: /I understand/ }).check();
  await page.getByRole("button", { name: "Request account deletion" }).click();
  await expect(page.getByText("Your account is scheduled for deletion")).toBeVisible();
});

test("the request can be made with the keyboard alone", async ({ browser }) => {
  const page = await signIn(browser, `keyboard-${uniqueTag()}@example.com`);
  const open = page.getByRole("button", { name: "Delete my account…" });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Delete your account", level: 3 })).toBeFocused();
  await page.keyboard.press("Tab"); // password
  await expect(page.getByLabel(/Your password/)).toBeFocused();
  await page.keyboard.press("Tab"); // checkbox
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: /I understand/ })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Request account deletion" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Your account is scheduled for deletion")).toBeVisible();
});

test("once the waiting period has passed the account is gone for good, and its old sign-in cannot bring it back", async ({
  browser,
}) => {
  const email = `leaving-${uniqueTag()}@example.com`;
  const page = await signIn(browser, email);
  await page.getByRole("button", { name: "Delete my account…" }).click();
  await page.getByRole("checkbox", { name: /I understand/ }).check();
  await page.getByRole("button", { name: "Request account deletion" }).click();
  await expect(page.getByText("Your account is scheduled for deletion")).toBeVisible();

  // The daily clean-up before the date does nothing…
  expect((await processAccountDeletions(prisma(), cleanupDeps(inDays(1)))).completed).toBe(0);
  expect(await prisma().user.count({ where: { email } })).toBe(1);

  // …and after it, the account is deleted.
  await processAccountDeletions(prisma(), cleanupDeps(inDays(15)));
  expect(await prisma().user.count({ where: { email } })).toBe(0);

  // A sign-in token that is still valid must not quietly create a new empty account.
  const token = await accessTokenFor(email);
  const response = await page.request.get(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(401);
  expect((await response.json()).error.code).toBe("ACCOUNT_DELETED");
  expect(await prisma().user.count({ where: { email } })).toBe(0);
});

test("a business owner's request waits for an administrator, who approves it; the business goes only after the waiting period", async ({
  browser,
  request,
}) => {
  const tag = uniqueTag();
  const sellerEmail = `owner-${tag}@example.com`;
  const businessName = `Deletion Bakery ${tag}`;
  await seedApprovedBusiness(request, {
    sellerEmail,
    businessName,
    description: "Cakes baked to order for every celebration.",
  });

  // The owner sees what it means for the business, and the review step.
  const seller = await signIn(browser, sellerEmail);
  await seller.getByRole("button", { name: "Delete my account…" }).click();
  const impact = seller.getByTestId("business-impact");
  await expect(impact).toContainText(businessName);
  await expect(impact).toContainText(/administrator reviews every request/);
  await expectNoHorizontalScroll(seller);
  await seller.getByRole("checkbox", { name: /I understand/ }).check();
  await seller.getByRole("button", { name: "Request account deletion" }).click();
  await expect(
    seller.getByText("Your request is waiting for an administrator’s review"),
  ).toBeVisible();
  await expect(seller.getByText("Nothing has been deleted yet.")).toBeVisible();

  // Even long after the waiting period, nothing happens without approval.
  await processAccountDeletions(prisma(), cleanupDeps(inDays(30)));
  expect(await prisma().user.count({ where: { email: sellerEmail } })).toBe(1);

  // The administrator finds it, checks what depends on the account, and approves.
  const admin = await newActor(browser);
  await admin.goto("/admin/deletions");
  await logIn(admin, ADMIN_EMAIL);
  await admin.goto("/admin/deletions");
  const card = admin.getByRole("listitem").filter({ hasText: sellerEmail });
  await expect(card).toBeVisible();
  await expect(card).toContainText(businessName);
  await expect(card).toContainText("Needs your decision");
  await expectNoHorizontalScroll(admin);
  expect(await violations(admin), "admin deletion list").toEqual([]);

  await card.getByRole("button", { name: "Approve deletion…" }).click();
  await expect(card.getByText(/Approving does not delete anything now/)).toBeVisible();
  await card.getByRole("button", { name: "Confirm approval" }).click();
  await admin.getByLabel("Filter requests by status").selectOption("APPROVED");
  const approved = admin.getByRole("listitem").filter({ hasText: sellerEmail });
  await expect(approved).toContainText("Approved. Carried out on or after");
  await approved.getByText("History").click();
  await expect(approved).toContainText("Approved by an administrator");

  // The owner now sees the approval, still not a deletion.
  await seller.reload();
  await expect(seller.getByText("Your request was approved")).toBeVisible();
  await expect(seller.getByText("Nothing has been deleted yet.")).toBeVisible();
  expect(await prisma().business.count({ where: { owner: { email: sellerEmail } } })).toBe(1);

  // After the waiting period the clean-up removes the account and the business.
  await processAccountDeletions(prisma(), cleanupDeps(inDays(15)));
  expect(await prisma().user.count({ where: { email: sellerEmail } })).toBe(0);
  expect(await prisma().business.count({ where: { revisions: { some: { businessName } } } })).toBe(
    0,
  );

  // The record of what happened stays, with counts and no personal details.
  await admin.getByLabel("Filter requests by status").selectOption("COMPLETED");
  const done = admin.getByRole("listitem").filter({ hasText: "Account no longer exists" });
  await expect(done.first()).toContainText("What was deleted");
  await expect(admin.getByText(sellerEmail)).toHaveCount(0);
});

test("an administrator can refuse, and the owner is shown the reason and can ask again", async ({
  browser,
  request,
}) => {
  const tag = uniqueTag();
  const sellerEmail = `refused-${tag}@example.com`;
  await seedApprovedBusiness(request, {
    sellerEmail,
    businessName: `Refusal Bakery ${tag}`,
    description: "Cakes baked to order for every celebration.",
  });
  const seller = await signIn(browser, sellerEmail);
  await seller.getByRole("button", { name: "Delete my account…" }).click();
  await seller.getByRole("checkbox", { name: /I understand/ }).check();
  await seller.getByRole("button", { name: "Request account deletion" }).click();
  await expect(seller.getByText(/waiting for an administrator/)).toBeVisible();

  const admin = await newActor(browser);
  await admin.goto("/admin/deletions");
  await logIn(admin, ADMIN_EMAIL);
  await admin.goto("/admin/deletions");
  const card = admin.getByRole("listitem").filter({ hasText: sellerEmail });
  await card.getByRole("button", { name: "Refuse…" }).click();
  await expect(card.getByRole("button", { name: "Refuse request" })).toBeDisabled();
  await card
    .getByLabel(/Reason shown to the person/)
    .fill("Please finish your open website project.");
  await card.getByRole("button", { name: "Refuse request" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: sellerEmail })).toHaveCount(0);

  await seller.reload();
  await expect(
    seller.getByText(/wasn’t approved: Please finish your open website project\./),
  ).toBeVisible();
  expect(await prisma().user.count({ where: { email: sellerEmail } })).toBe(1);
  await expect(seller.getByRole("button", { name: "Delete my account…" })).toBeVisible();
});

test("the deletion pages are closed to people who are not signed in or not administrators", async ({
  browser,
}) => {
  const anonymous = await newActor(browser);
  const unsigned = await anonymous.request.get(`${API_URL}/api/me/deletion`);
  expect(unsigned.status()).toBe(401);
  expect((await anonymous.request.get(`${API_URL}/api/admin/deletions`)).status()).toBe(401);

  const customerEmail = `curious-${uniqueTag()}@example.com`;
  const customer = await signIn(browser, customerEmail);
  const forbidden = await customer.request.get(`${API_URL}/api/admin/deletions`, {
    headers: { Authorization: `Bearer ${await accessTokenFor(customerEmail)}` },
  });
  expect(forbidden.status()).toBe(403);
  await customer.goto("/admin/deletions");
  await expect(customer.getByRole("heading", { name: "Account deletions" })).toHaveCount(0);
});
