import { expect, test, type Page } from "@playwright/test";
import { buildBusiness, buildCreation } from "../../apps/api/src/dev/builders.ts";
import { disconnectPrisma, getPrisma } from "../../apps/api/src/lib/prisma.ts";
import { newActor, uniqueTag } from "../support/actors.ts";
import { DATABASE_URL } from "../support/env.ts";

test.afterAll(async () => {
  await disconnectPrisma();
});

/** The prepared message inside a wa.me link. */
const messageIn = (href: string) => new URL(href).searchParams.get("text") ?? "";
const numberIn = (href: string) => new URL(href).pathname.replace("/", "");

async function seedTwoBusinesses(tag: string) {
  const prisma = getPrisma(DATABASE_URL);
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "businesses" CASCADE');
  const maria = await buildBusiness(prisma, {
    name: `Maria Cakes ${tag}`,
    slug: `maria-cakes-${tag}`,
    whatsappNumber: "+254711000001",
    websiteUrl: "https://maria-cakes.example.com",
  });
  const joseph = await buildBusiness(prisma, {
    name: `Joseph Photos ${tag}`,
    slug: `joseph-photos-${tag}`,
    categorySlug: "photography",
    whatsappNumber: "+254722000002",
  });
  const cake = await buildCreation(prisma, {
    businessId: maria.businessId,
    title: `Honey cake ${tag}`,
    description: "A honey sponge with cream cheese frosting.",
  });
  const shoot = await buildCreation(prisma, {
    businessId: joseph.businessId,
    title: `Graduation shoot ${tag}`,
    categorySlug: "photography",
    description: "A relaxed outdoor graduation photo session.",
  });
  return { maria, joseph, cake, shoot };
}

/** Lets the link be clicked without opening WhatsApp or any other site. */
async function blockExternal(page: Page) {
  // On the whole browser context, so the pop-up window is covered as well as the page.
  await page
    .context()
    .route("https://wa.me/**", (route) => route.fulfill({ status: 200, body: "blocked in test" }));
  await page
    .context()
    .route("https://api.whatsapp.com/**", (route) =>
      route.fulfill({ status: 200, body: "blocked in test" }),
    );
}

test("each WhatsApp link goes to its own business, with the right creation in the message", async ({
  browser,
}) => {
  const tag = uniqueTag();
  const { maria, joseph, cake, shoot } = await seedTwoBusinesses(tag);
  const page = await newActor(browser);

  // --- A creation by Maria ---
  await page.goto(`/creations/${cake.creationId}`);
  const about = page.getByRole("region", { name: "About the business" });
  const enquire = about.getByRole("link", { name: "Enquire on WhatsApp" });
  const href = (await enquire.getAttribute("href"))!;
  expect(href).toMatch(/^https:\/\/wa\.me\/254711000001\?text=/);
  expect(numberIn(href)).toBe("254711000001");
  const text = messageIn(href);
  expect(text).toContain(`Maria Cakes ${tag}`);
  expect(text).toContain(`Honey cake ${tag}`);
  expect(text).toContain(`/creations/${cake.creationId}`);
  // Nothing about the other business leaks into this message or number.
  expect(href).not.toContain("254722000002");
  expect(text).not.toContain("Joseph");
  expect(text).not.toContain("Graduation");

  // --- A creation by Joseph ---
  await page.goto(`/creations/${shoot.creationId}`);
  const otherAbout = page.getByRole("region", { name: "About the business" });
  const otherHref = (await otherAbout
    .getByRole("link", { name: "Enquire on WhatsApp" })
    .getAttribute("href"))!;
  expect(numberIn(otherHref)).toBe("254722000002");
  expect(messageIn(otherHref)).toContain(`Joseph Photos ${tag}`);
  expect(messageIn(otherHref)).toContain(`Graduation shoot ${tag}`);
  expect(messageIn(otherHref)).not.toContain("Maria");

  // --- Business profiles ---
  await page.goto(`/businesses/${maria.slug}`);
  const profileHref = (await page
    .getByRole("link", { name: "Message on WhatsApp" })
    .getAttribute("href"))!;
  expect(numberIn(profileHref)).toBe("254711000001");
  expect(messageIn(profileHref)).toContain(`Maria Cakes ${tag}`);
  await page.goto(`/businesses/${joseph.slug}`);
  expect(
    numberIn((await page.getByRole("link", { name: "Message on WhatsApp" }).getAttribute("href"))!),
  ).toBe("254722000002");
});

test("clicking records an anonymous event and sends nothing, and the website link opens the right site", async ({
  browser,
}) => {
  const tag = uniqueTag();
  const { maria, cake } = await seedTwoBusinesses(tag);
  const page = await newActor(browser);
  await blockExternal(page);
  await page
    .context()
    .route("https://maria-cakes.example.com/**", (route) =>
      route.fulfill({ status: 200, body: "site" }),
    );

  const events: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/public/events") && request.method() === "POST") {
      events.push(request.postDataJSON());
    }
  });

  await page.goto(`/creations/${cake.creationId}`);
  const about = page.getByRole("region", { name: "About the business" });
  const popupPromise = page.context().waitForEvent("page");
  await about.getByRole("link", { name: "Enquire on WhatsApp" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toMatch(/^https:\/\/wa\.me\/254711000001\?text=/);
  await expect
    .poll(() => events.some((e) => (e as { type?: string }).type === "WHATSAPP_CLICK"))
    .toBe(true);

  const click = events.find((e) => (e as { type?: string }).type === "WHATSAPP_CLICK") as Record<
    string,
    unknown
  >;
  expect(click).toMatchObject({
    type: "WHATSAPP_CLICK",
    creationId: cake.creationId,
    businessSlug: maria.slug,
  });
  // The event says what was clicked and nothing about who clicked or what was said.
  for (const field of ["phone", "email", "message", "text", "userId", "name"]) {
    expect(click).not.toHaveProperty(field);
  }
  expect(JSON.stringify(click)).not.toContain("254711000001");

  // The website link opens the business's own site, safely.
  const site = about.getByRole("link", { name: "Visit website" });
  await expect(site).toHaveAttribute("href", "https://maria-cakes.example.com");
  await expect(site).toHaveAttribute("rel", /noopener/);
  await expect(site).toHaveAttribute("target", "_blank");
});
