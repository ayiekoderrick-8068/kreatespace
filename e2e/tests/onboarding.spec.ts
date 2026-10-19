import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL } from "../support/env.ts";
import {
  PNG,
  expectNoHorizontalScroll,
  logIn,
  newActor,
  seedApprovedBusiness,
  uniqueTag,
} from "../support/actors.ts";

test("an invited seller registers, an admin approves, and the business goes public", async ({
  browser,
}) => {
  const tag = uniqueTag();
  const sellerEmail = `maria-${tag}@example.com`;
  const businessName = `Bakery ${tag}`;
  const slug = `bakery-${tag}`;

  // --- Admin invites the business owner -------------------------------------------------
  const admin = await newActor(browser);
  await admin.goto("/admin/invitations");
  await expect(admin.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await logIn(admin, ADMIN_EMAIL);
  await expect(admin.getByRole("heading", { name: "Administration" })).toBeVisible();

  await admin.getByLabel("Email address").fill(sellerEmail);
  await admin.getByRole("button", { name: "Create invitation" }).click();
  const inviteUrl = await admin.getByLabel("Invitation link").inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

  // --- The owner accepts on their phone and registers ----------------------------------
  const seller = await newActor(browser);
  await seller.goto(inviteUrl);
  await expect(seller.getByText(`This invitation is for ${sellerEmail}.`)).toBeVisible();
  await expectNoHorizontalScroll(seller);

  await seller.getByRole("link", { name: "I already have an account" }).click();
  await logIn(seller, sellerEmail);
  await seller.getByRole("button", { name: "Accept invitation" }).click();
  await expect(seller.getByRole("heading", { name: "Register your business" })).toBeVisible();

  // Step 1: details (an invalid number is rejected and the entered data is kept)
  await seller.getByLabel(/^Business name/).fill(businessName);
  await seller.getByLabel(/^Business owner/).fill("Maria Wanjiku");
  await seller
    .getByLabel(/^About your business/)
    .fill("Custom celebration cakes baked fresh to order in Nairobi.");
  await seller.getByLabel(/^Category/).selectOption({ label: "Cakes" });
  await seller.getByLabel(/^County/).selectOption("Nairobi");
  await seller.getByLabel(/^City or town/).fill("Westlands");
  await seller.getByLabel(/^WhatsApp Business number/).fill("12345");
  await seller.getByRole("button", { name: "Save and continue" }).click();
  await expect(seller.getByText(/Enter a valid WhatsApp number/)).toBeVisible();
  await expect(seller.getByLabel(/^Business name/)).toHaveValue(businessName);
  await expectNoHorizontalScroll(seller);

  await seller.getByLabel(/^WhatsApp Business number/).fill("0712 345 678");
  await seller.getByRole("button", { name: "Save and continue" }).click();

  // Step 2: photos
  await expect(seller.getByText("Step 2 of 3")).toBeVisible();
  await seller.getByLabel("Add photos").setInputFiles({
    name: "cake.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(seller.getByRole("button", { name: "Remove photo 1" })).toBeVisible();
  await expectNoHorizontalScroll(seller);
  await seller.getByRole("button", { name: "Save and continue" }).click();

  // Step 3: agreements and submission
  await expect(seller.getByText("Step 3 of 3")).toBeVisible();
  await seller.getByRole("button", { name: "Submit for review" }).click();
  await expect(seller.getByText("You must accept the seller terms")).toBeVisible();
  await seller.getByLabel(/I agree to the KreateSpace seller terms/).check();
  await seller.getByLabel(/I own, or have permission to share/).check();
  await seller.getByRole("button", { name: "Submit for review" }).click();
  await expect(seller.getByRole("heading", { name: "Application submitted" })).toBeVisible();
  await expectNoHorizontalScroll(seller);

  await seller.getByRole("link", { name: "Go to your dashboard" }).click();
  await expect(seller.getByText("We’re reviewing your application")).toBeVisible();

  // --- A visitor cannot see the pending business ----------------------------------------
  const visitor = await newActor(browser);
  await visitor.goto(`/businesses/${slug}`);
  await expect(visitor.getByRole("heading", { name: "Business not found" })).toBeVisible();

  // --- The invitation is single-use ----------------------------------------------------
  await visitor.goto(inviteUrl);
  await expect(visitor.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();

  // --- Admin reviews and approves -------------------------------------------------------
  await admin.goto("/admin/businesses");
  await admin.getByLabel("Search applications").fill(tag);
  await admin.getByRole("button", { name: "Search" }).click();
  await admin.getByRole("link", { name: businessName }).click();
  await expect(admin.getByRole("region", { name: "Submission to review" })).toBeVisible();
  await admin.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByRole("button", { name: "Suspend business" })).toBeVisible();

  // --- The business is now public ---------------------------------------------------------
  await visitor.goto(`/businesses/${slug}`);
  await expect(visitor.getByRole("heading", { name: businessName, level: 1 })).toBeVisible();
  const whatsapp = visitor.getByRole("link", { name: "Message on WhatsApp" });
  await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/254712345678\?text=/);
  const photo = visitor.getByRole("img", { name: /portfolio photo 1/ });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await expectNoHorizontalScroll(visitor);

  // --- The seller sees the decision --------------------------------------------------------
  await seller.goto("/seller");
  await expect(seller.getByText("Your public profile")).toBeVisible();

  // --- Admin suspends: the page disappears; reinstating brings it back --------------------
  await admin.getByLabel(/Reason or feedback/).fill("Temporarily hidden while we verify details.");
  await admin.getByRole("button", { name: "Suspend business" }).click();
  await expect(admin.getByRole("button", { name: "Reinstate business" })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole("heading", { name: "Business not found" })).toBeVisible();
  await admin.getByRole("button", { name: "Reinstate business" }).click();
  await expect(admin.getByRole("button", { name: "Suspend business" })).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole("heading", { name: businessName, level: 1 })).toBeVisible();
});

test("edits to a live profile stay hidden until an admin approves them", async ({
  browser,
  request,
}) => {
  const tag = uniqueTag();
  const sellerEmail = `joy-${tag}@example.com`;
  const businessName = `Florist ${tag}`;
  const slug = `florist-${tag}`;
  const original = "Fresh flowers and gift bouquets delivered across Nairobi.";
  const updated = "Wedding florals, bouquets and gift hampers delivered across Nairobi.";

  await seedApprovedBusiness(request, { sellerEmail, businessName, description: original });

  const visitor = await newActor(browser);
  await visitor.goto(`/businesses/${slug}`);
  await expect(visitor.getByText(original)).toBeVisible();

  // The seller edits their profile and submits the change.
  const seller = await newActor(browser);
  await seller.goto("/seller/edit");
  await logIn(seller, sellerEmail);
  await expect(seller.getByRole("heading", { name: "Edit your profile" })).toBeVisible();
  await seller.getByRole("button", { name: "Start editing" }).click();
  await expect(seller.getByRole("heading", { name: "Update your profile" })).toBeVisible();
  await seller.getByLabel(/^About your business/).fill(updated);
  await seller.getByRole("button", { name: "Save and continue" }).click();
  await expect(seller.getByText("Step 2 of 3")).toBeVisible();
  await seller.getByRole("button", { name: "Save and continue" }).click();
  await seller.getByRole("button", { name: "Submit update for review" }).click();
  await expect(seller.getByRole("heading", { name: "Update submitted" })).toBeVisible();
  await expectNoHorizontalScroll(seller);

  // Visitors still see the approved version.
  await visitor.reload();
  await expect(visitor.getByText(original)).toBeVisible();
  await expect(visitor.getByText(updated)).toHaveCount(0);

  // The admin compares the update with the live profile, then approves it.
  const admin = await newActor(browser);
  await admin.goto("/admin/businesses");
  await logIn(admin, ADMIN_EMAIL);
  await admin.getByLabel("Filter by status").selectOption("PENDING");
  await admin.getByRole("link", { name: businessName }).click();
  await expect(admin.getByRole("region", { name: "Currently live" })).toContainText(original);
  await expect(admin.getByRole("region", { name: "Submission to review" })).toContainText(updated);
  await admin.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByRole("button", { name: "Suspend business" })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await visitor.reload();
  await expect(visitor.getByText(updated)).toBeVisible();
  await expect(visitor.getByText(original)).toHaveCount(0);
});
