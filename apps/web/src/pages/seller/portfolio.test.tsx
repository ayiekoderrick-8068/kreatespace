import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as uploads from "../../lib/uploads";
import type * as Uploads from "../../lib/uploads";
import { mockApi, user } from "../../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../../test/renderWithProviders";

vi.mock("../../lib/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof Uploads>()),
  uploadToStorage: vi.fn().mockResolvedValue(undefined),
}));

const CATEGORY = { id: "11111111-1111-4111-8111-111111111111", slug: "cakes", name: "Cakes" };
const OCCASION = { id: "33333333-3333-4333-8333-333333333333", slug: "birthday", name: "Birthday" };
const ID = "44444444-4444-4444-8444-444444444444";

const approvedBusiness = {
  business: { id: "b1", slug: "cakes-by-maria", status: "APPROVED", createdAt: "2026-10-19" },
  revision: {
    id: "r1",
    version: 1,
    status: "APPROVED",
    businessName: "Cakes by Maria",
    ownerName: "Maria",
    description: "Custom celebration cakes baked fresh to order in Nairobi.",
    category: CATEGORY,
    county: "Nairobi",
    city: "Westlands",
    websiteUrl: null,
    whatsappNumber: "+254712345678",
    logoPath: null,
    logoUrl: null,
    images: [],
    termsAccepted: true,
    contentAuthorized: true,
    submittedAt: null,
  },
  publishedRevision: null,
  decisions: [],
};

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  status: "DRAFT",
  title: "Floral Birthday Cake",
  category: { slug: "cakes", name: "Cakes" },
  revisionStatus: "DRAFT",
  hasPublishedVersion: false,
  imageCount: 2,
  cover: { url: "https://img.test/1.jpg", width: 800, height: 1000 },
  updatedAt: "2026-10-19T08:00:00.000Z",
  latestFeedback: null,
  ...overrides,
});

const usage = (used: number, byStatus: Record<string, number> = {}) => ({
  used,
  limit: 20,
  remaining: 20 - used,
  byStatus,
});

const image = (n: number) => ({
  id: `img-${n}`,
  position: n - 1,
  width: 800,
  height: 1000,
  url: `https://img.test/${n}.jpg`,
});

function creationView(overrides: Record<string, unknown> = {}, status = "DRAFT", editable = true) {
  return {
    creation: {
      id: ID,
      status,
      createdAt: "2026-10-19",
      updatedAt: "2026-10-19",
      editable,
      canStartRevision: false,
    },
    revision: {
      id: "rev1",
      version: 1,
      status: status === "APPROVED" ? "APPROVED" : status,
      title: "Floral Birthday Cake",
      description: "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
      category: CATEGORY,
      occasion: OCCASION,
      submittedAt: null,
      images: [image(1), image(2)],
      ...overrides,
    },
    publishedRevision: null,
    decisions: [],
  };
}

const sellerClient = () => createFakeAuth(fakeSession()).client;
const baseRoutes = {
  "GET /api/me": user("SELLER"),
  "GET /api/businesses/me": { body: approvedBusiness },
  "GET /api/categories": { body: { categories: [CATEGORY] } },
  "GET /api/occasions": { body: { occasions: [OCCASION] } },
};

beforeEach(() => {
  vi.mocked(uploads.uploadToStorage).mockClear();
});

describe("seller portfolio dashboard", () => {
  it("shows the allowance, counts by status and the creations", async () => {
    mockApi({
      ...baseRoutes,
      "GET /api/creations": {
        body: {
          creations: [
            summary(),
            summary({
              id: "c2",
              status: "APPROVED",
              title: "Wedding Cake",
              revisionStatus: "APPROVED",
              hasPublishedVersion: true,
            }),
            summary({
              id: "c3",
              status: "CHANGES_REQUESTED",
              title: "Fashion Piece",
              revisionStatus: "CHANGES_REQUESTED",
              latestFeedback: {
                action: "CHANGES_REQUESTED",
                reason: "Please add a clearer photo.",
              },
            }),
          ],
          usage: usage(12, {
            DRAFT: 4,
            APPROVED: 5,
            PENDING: 1,
            CHANGES_REQUESTED: 1,
            REJECTED: 1,
            ARCHIVED: 3,
          }),
        },
      },
    });
    renderApp("/seller", sellerClient());

    expect(await screen.findByText("12 of 20 creations used")).toBeInTheDocument();
    expect(screen.getByText(/8 free slots left/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Free creations used" })).toHaveAttribute(
      "aria-valuenow",
      "12",
    );

    const stats = screen.getByRole("heading", { name: "Your portfolio" }).closest("section")!;
    const stat = (label: string) => within(stats).getByText(label).nextElementSibling!.textContent;
    expect(stat("Published")).toBe("5");
    expect(stat("Drafts")).toBe("4");
    expect(stat("Pending review")).toBe("1");
    expect(stat("Needs attention")).toBe("2");
    expect(stat("Archived")).toBe("3");

    const list = screen.getByRole("list", { name: "Your creations" });
    expect(within(list).getByRole("link", { name: "Floral Birthday Cake" })).toHaveAttribute(
      "href",
      `/seller/creations/${ID}`,
    );
    expect(within(list).getByText("“Please add a clearer photo.”")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add new creation" })).toHaveAttribute(
      "href",
      "/seller/creations/new",
    );
    expect(screen.getByRole("link", { name: "Manage service packages" })).toHaveAttribute(
      "href",
      "/seller/packages",
    );
    expect(screen.getByRole("link", { name: "/businesses/cakes-by-maria" })).toBeInTheDocument();
  });

  it("explains the limit and removes the add button when all slots are used", async () => {
    mockApi({
      ...baseRoutes,
      "GET /api/creations": { body: { creations: [summary()], usage: usage(20, { DRAFT: 20 }) } },
    });
    renderApp("/seller", sellerClient());
    expect(await screen.findByText("20 of 20 creations used")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add new creation" })).not.toBeInTheDocument();
    expect(screen.getByText(/Archive one to add another/)).toBeInTheDocument();
  });

  it("encourages a first creation when there are none", async () => {
    mockApi({ ...baseRoutes, "GET /api/creations": { body: { creations: [], usage: usage(0) } } });
    renderApp("/seller", sellerClient());
    expect(await screen.findByText("0 of 20 creations used")).toBeInTheDocument();
    expect(screen.getByText(/haven’t added any creations yet/)).toBeInTheDocument();
  });

  it("copes with the portfolio failing to load", async () => {
    mockApi({
      ...baseRoutes,
      "GET /api/creations": {
        status: 500,
        body: { error: { code: "INTERNAL_ERROR", message: "x" } },
      },
    });
    renderApp("/seller", sellerClient());
    expect(await screen.findByText(/couldn’t load your creations/i)).toBeInTheDocument();
    expect(screen.getByText("Your public profile")).toBeInTheDocument();
  });
});

describe("adding a creation", () => {
  it("validates, then saves a draft and opens the editor", async () => {
    const api = mockApi({
      ...baseRoutes,
      "POST /api/creations": { status: 201, body: { creationId: ID } },
      [`GET /api/creations/${ID}`]: { body: creationView() },
      "GET /api/creations": { body: { creations: [], usage: usage(1) } },
    });
    const u = userEvent.setup();
    renderApp("/seller/creations/new", sellerClient());

    await u.click(await screen.findByRole("button", { name: "Save draft and add photos" }));
    expect(await screen.findByText(/title of at least 3 characters/)).toBeInTheDocument();
    expect(api.find("POST", "/api/creations")).toHaveLength(0);

    await u.type(screen.getByLabelText(/^Title/), "Floral Birthday Cake");
    await u.type(
      screen.getByLabelText(/^Description/),
      "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
    );
    await u.selectOptions(screen.getByLabelText(/^Category/), CATEGORY.id);
    await u.selectOptions(screen.getByLabelText(/^Occasion/), OCCASION.id);
    await u.click(screen.getByRole("button", { name: "Save draft and add photos" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Floral Birthday Cake" }),
    ).toBeInTheDocument();
    expect(api.find("POST", "/api/creations")[0]!.body).toEqual({
      title: "Floral Birthday Cake",
      description: "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
      categoryId: CATEGORY.id,
      occasionId: OCCASION.id,
    });
  });

  it("shows the server's message when the limit is reached", async () => {
    mockApi({
      ...baseRoutes,
      "POST /api/creations": {
        status: 409,
        body: {
          error: {
            code: "CREATION_LIMIT_REACHED",
            message: "You have used all 20 free creations. Archive one to add another.",
          },
        },
      },
    });
    const u = userEvent.setup();
    renderApp("/seller/creations/new", sellerClient());
    await u.type(await screen.findByLabelText(/^Title/), "Another cake");
    await u.type(
      screen.getByLabelText(/^Description/),
      "A lovely cake made with plenty of care and attention.",
    );
    await u.selectOptions(screen.getByLabelText(/^Category/), CATEGORY.id);
    await u.click(screen.getByRole("button", { name: "Save draft and add photos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/used all 20 free creations/);
  });
});

describe("creation editor", () => {
  function setup(view = creationView(), extra: Record<string, unknown> = {}) {
    return mockApi({
      ...baseRoutes,
      [`GET /api/creations/${ID}`]: { body: view },
      "GET /api/creations": { body: { creations: [], usage: usage(1) } },
      ...extra,
    } as Parameters<typeof mockApi>[0]);
  }

  it("shows a draft with its photos, the photo count and an editable form", async () => {
    setup();
    renderApp(`/seller/creations/${ID}`, sellerClient());
    expect(
      await screen.findByRole("heading", { level: 1, name: "Floral Birthday Cake" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 5 photos")).toBeInTheDocument();
    expect(screen.getByText("Cover photo")).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Title/)).toHaveValue("Floral Birthday Cake");
    expect(screen.getByLabelText(/^Category/)).toHaveValue(CATEGORY.id);
    expect(screen.getByLabelText(/^Occasion/)).toHaveValue(OCCASION.id);
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
  });

  it("saves edits", async () => {
    const api = setup(creationView(), {
      [`PATCH /api/creations/${ID}`]: { body: creationView({ title: "Renamed Cake" }) },
    });
    const u = userEvent.setup();
    renderApp(`/seller/creations/${ID}`, sellerClient());
    const title = await screen.findByLabelText(/^Title/);
    await u.clear(title);
    await u.type(title, "Renamed Cake");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Changes saved.")).toBeInTheDocument();
    expect(api.find("PATCH", `/api/creations/${ID}`)[0]!.body).toMatchObject({
      title: "Renamed Cake",
    });
  });

  it("uploads photos with progress and refuses unsupported or oversized files before sending them", async () => {
    let attached = false;
    const api = setup(creationView({ images: [image(1)] }), {
      [`GET /api/creations/${ID}`]: () => ({
        body: creationView({ images: attached ? [image(1), image(2)] : [image(1)] }),
      }),
      [`POST /api/creations/${ID}/uploads`]: {
        status: 201,
        body: {
          path: `businesses/b1/creations/${ID}/new.jpg`,
          uploadUrl: "https://x",
          token: "tok",
        },
      },
      [`POST /api/creations/${ID}/images`]: () => {
        attached = true;
        return { status: 201, body: creationView({ images: [image(1), image(2)] }) };
      },
    });
    const u = userEvent.setup({ applyAccept: false });
    renderApp(`/seller/creations/${ID}`, sellerClient());
    const input = await screen.findByLabelText("Add photos");

    await u.upload(
      input,
      new File([new Uint8Array(100)], "notes.pdf", { type: "application/pdf" }),
    );
    expect(
      await screen.findByText(/notes\.pdf: couldn’t be added\. notes\.pdf: only JPEG, PNG or WebP/),
    ).toBeInTheDocument();
    await u.upload(
      input,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByText(/huge\.jpg: couldn’t be added/)).toBeInTheDocument();
    expect(api.find("POST", `/api/creations/${ID}/uploads`)).toHaveLength(0);

    await u.upload(input, new File([new Uint8Array(2048)], "cake.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("cake.jpg: added")).toBeInTheDocument();
    expect(uploads.uploadToStorage).toHaveBeenCalledWith(
      `businesses/b1/creations/${ID}/new.jpg`,
      "tok",
      expect.any(File),
    );
    expect(await screen.findByText("2 of 5 photos")).toBeInTheDocument();
  });

  it("shows the server's reason when a photo is rejected", async () => {
    setup(creationView({ images: [] }), {
      [`POST /api/creations/${ID}/uploads`]: {
        status: 201,
        body: { path: `businesses/b1/creations/${ID}/x.jpg`, uploadUrl: "u", token: "t" },
      },
      [`POST /api/creations/${ID}/images`]: {
        status: 400,
        body: {
          error: {
            code: "INVALID_IMAGE",
            message: "The image is too small. Use at least 200 pixels on each side.",
          },
        },
      },
    });
    const u = userEvent.setup({ applyAccept: false });
    renderApp(`/seller/creations/${ID}`, sellerClient());
    await u.upload(
      await screen.findByLabelText("Add photos"),
      new File([new Uint8Array(500)], "tiny.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByText(/too small\. Use at least 200 pixels/)).toBeInTheDocument();
  });

  it("stops accepting photos at the limit of five", async () => {
    setup(creationView({ images: [1, 2, 3, 4, 5].map(image) }));
    renderApp(`/seller/creations/${ID}`, sellerClient());
    expect(await screen.findByText("5 of 5 photos")).toBeInTheDocument();
    expect(screen.getByLabelText("Add photos")).toBeDisabled();
  });

  it("reorders and removes photos", async () => {
    const api = setup(creationView(), {
      [`PUT /api/creations/${ID}/images/order`]: {
        body: creationView({ images: [image(2), image(1)] }),
      },
      [`DELETE /api/creations/${ID}/images/img-2`]: { body: creationView({ images: [image(1)] }) },
    });
    const u = userEvent.setup();
    renderApp(`/seller/creations/${ID}`, sellerClient());
    await u.click(await screen.findByRole("button", { name: "Move photo 1 later" }));
    await waitFor(() =>
      expect(api.find("PUT", `/api/creations/${ID}/images/order`)).toHaveLength(1),
    );
    expect(api.find("PUT", `/api/creations/${ID}/images/order`)[0]!.body).toEqual({
      imageIds: ["img-2", "img-1"],
    });

    expect(screen.getByRole("button", { name: "Move photo 1 earlier" })).toBeDisabled();
    // After the reorder the former second photo (img-2) is first.
    await u.click(screen.getByRole("button", { name: "Remove photo 1" }));
    await waitFor(() =>
      expect(api.find("DELETE", `/api/creations/${ID}/images/img-2`)).toHaveLength(1),
    );
  });

  it("submits for review, and explains what's missing when it can't", async () => {
    let fail = true;
    const api = setup(creationView(), {
      [`POST /api/creations/${ID}/submit`]: () =>
        fail
          ? {
              status: 400,
              body: {
                error: {
                  code: "VALIDATION_ERROR",
                  message: "x",
                  details: { fields: { images: "Add at least one photo before submitting" } },
                },
              },
            }
          : { body: creationView({}, "PENDING", false) },
    });
    const u = userEvent.setup();
    renderApp(`/seller/creations/${ID}`, sellerClient());
    await u.click(await screen.findByRole("button", { name: "Submit for review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add at least one photo before submitting",
    );

    fail = false;
    await u.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText("Submitted for review.")).toBeInTheDocument();
    expect(screen.getByText(/Awaiting review\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
    expect(api.find("POST", `/api/creations/${ID}/submit`)).toHaveLength(2);
  });

  it("locks everything while awaiting review", async () => {
    setup(creationView({}, "PENDING", false));
    renderApp(`/seller/creations/${ID}`, sellerClient());
    await screen.findByRole("heading", { level: 1, name: "Floral Birthday Cake" });
    expect(await screen.findByLabelText(/^Title/)).toBeDisabled();
    expect(screen.queryByLabelText("Add photos")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove photo/ })).not.toBeInTheDocument();
  });

  it("shows the admin's feedback on a returned creation", async () => {
    const view = creationView({}, "CHANGES_REQUESTED");
    view.decisions = [
      {
        id: "d1",
        action: "CHANGES_REQUESTED",
        reason: "Please add a clearer photo of the top tier.",
        createdAt: "2026-10-20",
        revisionId: "rev1",
      },
    ] as never;
    setup(view);
    renderApp(`/seller/creations/${ID}`, sellerClient());
    const quote = (await screen.findByText("Feedback from our team")).closest("blockquote")!;
    expect(
      within(quote).getByText("Please add a clearer photo of the top tier."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
  });

  it("lets a live creation be edited without changing the live version", async () => {
    const live = creationView({}, "APPROVED", false);
    live.creation.canStartRevision = true;
    const draft = creationView({ id: "rev2", version: 2, status: "DRAFT" }, "APPROVED", true);
    let started = false;
    const api = setup(live, {
      [`GET /api/creations/${ID}`]: () => ({ body: started ? draft : live }),
      [`POST /api/creations/${ID}/revisions`]: () => {
        started = true;
        return { status: 201, body: draft };
      },
    });
    const u = userEvent.setup();
    renderApp(`/seller/creations/${ID}`, sellerClient());
    expect(await screen.findByText(/stays as it is until they’re approved/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Edit this creation" }));
    expect(await screen.findByText("You can now edit this creation.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toBeEnabled();
    expect(api.find("POST", `/api/creations/${ID}/revisions`)).toHaveLength(1);
  });

  it("archives only after confirmation", async () => {
    const api = setup(creationView(), {
      [`POST /api/creations/${ID}/archive`]: { body: creationView({}, "ARCHIVED", false) },
    });
    const u = userEvent.setup();
    renderApp(`/seller/creations/${ID}`, sellerClient());
    await u.click(await screen.findByRole("button", { name: "Archive creation" }));
    expect(api.find("POST", `/api/creations/${ID}/archive`)).toHaveLength(0);
    expect(screen.getByText(/free up one of your 20 slots/)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Yes, archive it" }));
    expect(await screen.findByText("Creation archived.")).toBeInTheDocument();
    expect(screen.getByText(/This creation is archived/)).toBeInTheDocument();
  });

  it("handles creations that aren't the seller's", async () => {
    mockApi({
      ...baseRoutes,
      [`GET /api/creations/${ID}`]: {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "Creation not found" } },
      },
    });
    renderApp(`/seller/creations/${ID}`, sellerClient());
    expect(await screen.findByText("We couldn’t find that creation.")).toBeInTheDocument();
  });
});
