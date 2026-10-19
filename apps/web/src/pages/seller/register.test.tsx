import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as uploads from "../../lib/uploads";
import type * as Uploads from "../../lib/uploads";
import { mockApi, user } from "../../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../../test/renderWithProviders";

vi.mock("../../lib/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof Uploads>()),
  uploadToStorage: vi.fn().mockResolvedValue(undefined),
  previewUrlFor: () => null,
}));

const CATEGORIES = [
  { id: "11111111-1111-4111-8111-111111111111", slug: "cakes", name: "Cakes" },
  { id: "22222222-2222-4222-8222-222222222222", slug: "fashion", name: "Fashion" },
];
const BUSINESS_ID = "9c1d7e3a-1f0b-4c52-8a60-7d2e5b1f4a33";

function ownBusiness(overrides: Record<string, unknown> = {}) {
  return {
    business: { id: BUSINESS_ID, slug: "cakes-by-maria", status: "DRAFT", createdAt: "2026-10-19" },
    revision: {
      id: "r1",
      version: 1,
      status: "DRAFT",
      businessName: "Cakes by Maria",
      ownerName: "Maria Wanjiku",
      description: "Custom celebration cakes baked fresh to order in Nairobi.",
      category: CATEGORIES[0],
      county: "Nairobi",
      city: "Westlands",
      websiteUrl: null,
      whatsappNumber: "+254712345678",
      logoPath: null,
      logoUrl: null,
      images: [],
      termsAccepted: false,
      contentAuthorized: false,
      submittedAt: null,
      ...overrides,
    },
    publishedRevision: null,
    decisions: [],
  };
}

let u: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  u = userEvent.setup({ applyAccept: false });
  vi.mocked(uploads.uploadToStorage).mockClear();
});

async function fillDetails() {
  await u.type(await screen.findByLabelText(/^Business name/), "Cakes by Maria");
  await u.type(screen.getByLabelText(/^Business owner/), "Maria Wanjiku");
  await u.type(
    screen.getByLabelText(/^About your business/),
    "Custom celebration cakes baked fresh to order in Nairobi.",
  );
  await u.selectOptions(screen.getByLabelText(/^Category/), CATEGORIES[0]!.id);
  await u.selectOptions(screen.getByLabelText(/^County/), "Nairobi");
  await u.type(screen.getByLabelText(/^City or town/), "Westlands");
  await u.type(screen.getByLabelText(/^WhatsApp Business number/), "0712 345 678");
}

function imageFile(name = "cake.jpg", type = "image/jpeg", size = 2048) {
  return new File([new Uint8Array(size)], name, { type });
}

describe("seller access", () => {
  it("is closed to customers", async () => {
    mockApi({ "GET /api/me": user("CUSTOMER") });
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);
    expect(
      await screen.findByRole("heading", { name: "You don’t have access to this page" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/by invitation/i)).toBeInTheDocument();
  });
});

describe("business registration form", () => {
  function setup(routes: Parameters<typeof mockApi>[0] = {}) {
    return mockApi({
      "GET /api/me": user("SELLER"),
      "GET /api/categories": { body: { categories: CATEGORIES } },
      "GET /api/businesses/me": {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "none" } },
      },
      ...routes,
    });
  }

  it("shows progress and marks required and optional fields", async () => {
    setup();
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);
    expect(await screen.findByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Business details")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("(optional)")).toBeInTheDocument();
    expect(screen.getByText(/No website\? No problem/)).toBeInTheDocument();
  });

  it("shows every validation error and keeps what was typed", async () => {
    const api = setup();
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);
    await u.type(await screen.findByLabelText(/^Business name/), "Cakes by Maria");
    await u.type(screen.getByLabelText(/^WhatsApp Business number/), "12345");
    await u.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByText("Enter the business owner's name")).toBeInTheDocument();
    expect(screen.getByText(/at least 30 characters/)).toBeInTheDocument();
    expect(screen.getByText("Choose a county", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/Enter a valid WhatsApp number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Business name/)).toHaveValue("Cakes by Maria");
    expect(screen.getByLabelText(/^WhatsApp Business number/)).toHaveValue("12345");
    expect(api.find("POST", "/api/businesses")).toHaveLength(0);
  });

  it("rejects an unsafe website address", async () => {
    setup();
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);
    await fillDetails();
    await u.type(screen.getByLabelText(/^Website/), "javascript:alert(1)");
    await u.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText(/full website address starting with https/)).toBeInTheDocument();
  });

  it("shows field errors returned by the server", async () => {
    setup({
      "POST /api/businesses": {
        status: 400,
        body: {
          error: {
            code: "VALIDATION_ERROR",
            message: "Some fields are invalid",
            details: { fields: { categoryId: "Choose a valid category" } },
          },
        },
      },
    });
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);
    await fillDetails();
    await u.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Choose a valid category")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Some fields are invalid");
  });

  it("walks through details, photos and review, then submits for approval", async () => {
    let created = false;
    const api = setup({
      "GET /api/businesses/me": () =>
        created
          ? { body: ownBusiness() }
          : { status: 404, body: { error: { code: "NOT_FOUND", message: "none" } } },
      "POST /api/businesses": () => {
        created = true;
        return { status: 201, body: { businessId: BUSINESS_ID } };
      },
      "POST /api/businesses/me/uploads": {
        status: 201,
        body: { path: `businesses/${BUSINESS_ID}/photo.jpg`, uploadUrl: "https://x", token: "tok" },
      },
      "PATCH /api/businesses/me": { body: ownBusiness() },
      "POST /api/businesses/me/submit": { body: ownBusiness() },
    });
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);

    // Step 1
    await fillDetails();
    await u.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();
    const created1 = api.find("POST", "/api/businesses")[0]!;
    expect(created1.body).toMatchObject({
      businessName: "Cakes by Maria",
      categoryId: CATEGORIES[0]!.id,
      county: "Nairobi",
      whatsappNumber: "+254712345678",
    });
    expect(created1.authorization).toBe("Bearer test-access-token");

    // Step 2: cannot continue without a photo
    await u.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(
      await screen.findByText("Add at least one portfolio photo to continue."),
    ).toBeInTheDocument();

    await u.upload(screen.getByLabelText("Add photos"), imageFile());
    await waitFor(() => expect(uploads.uploadToStorage).toHaveBeenCalledTimes(1));
    expect(api.find("POST", "/api/businesses/me/uploads")[0]!.body).toEqual({
      contentType: "image/jpeg",
      size: 2048,
    });
    expect(uploads.uploadToStorage).toHaveBeenCalledWith(
      `businesses/${BUSINESS_ID}/photo.jpg`,
      "tok",
      expect.any(File),
    );
    expect(await screen.findByRole("button", { name: "Remove photo 1" })).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Save and continue" }));

    // Step 3: agreements are required
    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText("You must accept the seller terms")).toBeInTheDocument();
    expect(api.find("POST", "/api/businesses/me/submit")).toHaveLength(0);

    await u.click(screen.getByLabelText(/agree to the KreateSpace\s+Seller Terms/));
    await u.click(screen.getByLabelText(/I own, or have permission to share/));
    await u.click(screen.getByRole("button", { name: "Submit for review" }));

    expect(
      await screen.findByRole("heading", { name: "Application submitted" }),
    ).toBeInTheDocument();
    const patches = api.find("PATCH", "/api/businesses/me");
    expect(patches.at(-1)!.body).toEqual({ termsAccepted: true, contentAuthorization: true });
    expect(
      patches.some((p) => (p.body as { portfolioPaths?: string[] }).portfolioPaths?.length === 1),
    ).toBe(true);
    expect(api.find("POST", "/api/businesses/me/submit")).toHaveLength(1);
  });

  it("refuses unsupported or oversized images before uploading", async () => {
    const api = setup({
      "GET /api/businesses/me": { body: ownBusiness() },
      "PATCH /api/businesses/me": { body: ownBusiness() },
    });
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);
    await u.click(await screen.findByRole("button", { name: "Save and continue" }));
    await screen.findByText("Step 2 of 3");

    await u.upload(screen.getByLabelText("Add photos"), imageFile("notes.pdf", "application/pdf"));
    expect(await screen.findByText(/notes.pdf: only JPEG, PNG or WebP/)).toBeInTheDocument();

    await u.upload(
      screen.getByLabelText("Add photos"),
      imageFile("huge.png", "image/png", 5 * 1024 * 1024 + 1),
    );
    expect(await screen.findByText(/huge.png: images must be 5 MB or smaller/)).toBeInTheDocument();
    expect(api.find("POST", "/api/businesses/me/uploads")).toHaveLength(0);
  });

  it("resumes a saved draft with its details filled in", async () => {
    setup({ "GET /api/businesses/me": { body: ownBusiness() } });
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);
    expect(await screen.findByLabelText(/^Business name/)).toHaveValue("Cakes by Maria");
    expect(screen.getByLabelText(/^City or town/)).toHaveValue("Westlands");
    // The saved category and county are selected, not reset to the placeholder.
    expect(screen.getByLabelText(/^Category/)).toHaveValue(CATEGORIES[0]!.id);
    expect(screen.getByLabelText(/^County/)).toHaveValue("Nairobi");
  });

  it("does not offer the form once the application is under review", async () => {
    setup({
      "GET /api/businesses/me": {
        body: { ...ownBusiness(), business: { ...ownBusiness().business, status: "PENDING" } },
      },
    });
    renderApp("/seller/register", createFakeAuth(fakeSession()).client);
    expect(await screen.findByRole("heading", { name: "Your application" })).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Business name/)).not.toBeInTheDocument();
  });
});
