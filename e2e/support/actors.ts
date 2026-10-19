import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { API_URL, ADMIN_EMAIL } from "./env.ts";
import { accessTokenFor, mockSupabase } from "./supabase-mock.ts";

export const PASSWORD = "password123";

/** A 1x1 PNG used as an uploaded photo. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Opens a fresh browser profile (like another person's phone) with the project's device settings. */
export async function newActor(browser: Browser): Promise<Page> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  await mockSupabase(context);
  return context.newPage();
}

/** Fills in the login form on the current page and waits to leave it. */
export async function logIn(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** The page must never scroll sideways: a common failure on small phones. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
}

export function uniqueTag(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function api(
  request: APIRequestContext,
  email: string,
  method: "get" | "post" | "patch",
  path: string,
  data?: unknown,
) {
  const response = await request[method](`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${await accessTokenFor(email)}` },
    data,
  });
  expect(response.ok(), `${method.toUpperCase()} ${path} -> ${response.status()}`).toBe(true);
  return response.json();
}

/** Registers and approves a business through the API, for tests that focus on later steps. */
export async function seedApprovedBusiness(
  request: APIRequestContext,
  options: { sellerEmail: string; businessName: string; description: string },
): Promise<void> {
  const { sellerEmail, businessName, description } = options;

  const invited = await api(request, ADMIN_EMAIL, "post", "/api/admin/invitations", {
    email: sellerEmail,
  });
  const token = String(invited.inviteUrl).split("/invite/")[1];
  await api(request, sellerEmail, "post", "/api/invitations/accept", { token });

  const { categories } = await api(request, sellerEmail, "get", "/api/categories");
  const cakes = categories.find((category: { slug: string }) => category.slug === "cakes");
  const { businessId } = await api(request, sellerEmail, "post", "/api/businesses", {
    businessName,
    ownerName: "Maria Wanjiku",
    description,
    categoryId: cakes.id,
    county: "Nairobi",
    city: "Westlands",
    websiteUrl: "",
    whatsappNumber: "0712 345 678",
  });
  const upload = await api(request, sellerEmail, "post", "/api/businesses/me/uploads", {
    contentType: "image/png",
    size: PNG.length,
  });
  await api(request, sellerEmail, "patch", "/api/businesses/me", {
    portfolioPaths: [upload.path],
    termsAccepted: true,
    contentAuthorization: true,
  });
  await api(request, sellerEmail, "post", "/api/businesses/me/submit");
  await api(request, ADMIN_EMAIL, "post", `/api/admin/businesses/${businessId}/decision`, {
    action: "APPROVE",
  });
}
