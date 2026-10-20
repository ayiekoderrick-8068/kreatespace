import type { Browser, Page } from "@playwright/test";
import { ADMIN_EMAIL } from "./env.ts";
import { logIn, newActor, seedApprovedBusiness, uniqueTag } from "./actors.ts";
import { seedCatalogue, type Catalogue } from "./data.ts";

export interface SiteFixture {
  tag: string;
  catalogue: Catalogue;
  sellerEmail: string;
  /** Public pages a visitor can open, by name. */
  publicPages: [name: string, path: string][];
  sellerPages: [name: string, path: string][];
  adminPages: [name: string, path: string][];
}

/** A catalogue of public content plus one approved seller, shared by the layout and accessibility checks. */
export async function seedSite(browser: Browser): Promise<SiteFixture> {
  const tag = uniqueTag();
  const catalogue = await seedCatalogue(tag);
  const sellerEmail = `seller-${tag}@example.com`;
  const page = await newActor(browser);
  await seedApprovedBusiness(page.request, {
    sellerEmail,
    businessName: `Seller Co ${tag}`,
    description: "Handmade celebration cakes baked to order in Nairobi.",
  });
  await page.context().close();

  return {
    tag,
    catalogue,
    sellerEmail,
    publicPages: [
      ["home", "/"],
      ["explore", "/explore"],
      ["explore with a search", `/explore?q=zq${tag}`],
      ["creation", `/creations/${catalogue.kisumuBakery.weddingCakeId}`],
      ["business profile", `/businesses/${catalogue.kisumuBakery.slug}`],
      ["login", "/login"],
      ["register", "/register"],
      ["forgot password", "/forgot-password"],
      ["about", "/about"],
      ["for businesses", "/for-businesses"],
      ["not found", "/this-page-does-not-exist"],
    ],
    sellerPages: [
      ["seller dashboard", "/seller"],
      ["seller analytics", "/seller/analytics"],
      ["seller website help", "/seller/website"],
      ["seller packages", "/seller/packages"],
      ["new creation", "/seller/creations/new"],
      ["edit profile", "/seller/edit"],
      ["account and deletion", "/account"],
    ],
    adminPages: [
      ["admin businesses", "/admin/businesses"],
      ["admin creations", "/admin/creations"],
      ["admin packages", "/admin/packages"],
      ["admin invitations", "/admin/invitations"],
      ["admin website requests", "/admin/website-requests"],
      ["admin imports", "/admin/imports"],
      ["admin deletions", "/admin/deletions"],
      ["admin analytics", "/admin/analytics"],
    ],
  };
}

/** A browser signed in as the given person, using the project's device settings. */
export async function signedIn(browser: Browser, email: string): Promise<Page> {
  const page = await newActor(browser);
  await page.goto("/login");
  await logIn(page, email);
  return page;
}

export { ADMIN_EMAIL };
