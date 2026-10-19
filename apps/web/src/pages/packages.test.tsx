import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as uploads from "../lib/uploads";
import type * as Uploads from "../lib/uploads";
import { mockApi, user } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";

vi.mock("../lib/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof Uploads>()),
  uploadToStorage: vi.fn().mockResolvedValue(undefined),
}));

const client = () => createFakeAuth(fakeSession()).client;

const view = (overrides: Record<string, unknown> = {}) => ({
  name: "Wedding Photography Package",
  description: "Full-day coverage of your wedding.",
  includes: ["Event coverage", "Edited photographs"],
  startingPriceKes: null,
  image: null,
  ...overrides,
});

const pkg = (overrides: Record<string, unknown> = {}) => ({
  id: "p1",
  status: "ACTIVE",
  reviewState: "DRAFT",
  editable: true,
  hasPublishedVersion: false,
  draft: view(),
  published: null,
  latestFeedback: null,
  updatedAt: "2026-10-19T08:00:00.000Z",
  ...overrides,
});

const listBody = (packages: unknown[], used = packages.length) => ({
  packages,
  usage: { used, limit: 10 },
});

beforeEach(() => {
  vi.mocked(uploads.uploadToStorage).mockClear();
});

describe("seller service packages", () => {
  const seller = { "GET /api/me": user("SELLER") };

  it("lists packages with status, price and feedback, never inventing a price", async () => {
    mockApi({
      ...seller,
      "GET /api/packages": {
        body: listBody([
          pkg({
            draft: view({ startingPriceKes: 80000 }),
            reviewState: "APPROVED",
            hasPublishedVersion: true,
          }),
          pkg({
            id: "p2",
            draft: view({ name: "Birthday Cake Package" }),
            reviewState: "CHANGES_REQUESTED",
            latestFeedback: {
              action: "CHANGES_REQUESTED",
              reason: "Please list the delivery options.",
            },
          }),
        ]),
      },
    });
    renderApp("/seller/packages", client());
    const list = await screen.findByRole("list", { name: "Your packages" });
    expect(within(list).getByText("From KSh 80,000")).toBeInTheDocument();
    expect(within(list).getByText("No price shown")).toBeInTheDocument();
    expect(within(list).getByText("Please list the delivery options.")).toBeInTheDocument();
    expect(screen.getByText(/used 2 of 10/)).toBeInTheDocument();
  });

  it("explains an empty list and hides the add button at the limit", async () => {
    mockApi({ ...seller, "GET /api/packages": { body: listBody([]) } });
    const { unmount } = renderApp("/seller/packages", client());
    expect(await screen.findByText(/haven’t added any service packages yet/)).toBeInTheDocument();
    unmount();

    mockApi({ ...seller, "GET /api/packages": { body: listBody([pkg()], 10) } });
    renderApp("/seller/packages", client());
    expect(await screen.findByText(/reached the limit/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a package" })).not.toBeInTheDocument();
  });

  it("validates a new package, turns lines into included items, and keeps the price optional", async () => {
    const api = mockApi({
      ...seller,
      "GET /api/packages": { body: listBody([]) },
      "POST /api/packages": { status: 201, body: pkg() },
    });
    const u = userEvent.setup();
    renderApp("/seller/packages", client());
    await u.click(await screen.findByRole("button", { name: "Add a package" }));
    await u.click(screen.getByRole("button", { name: "Save package" }));
    expect(await screen.findByText(/name of at least 3 characters/)).toBeInTheDocument();
    expect(screen.getByText(/at least one thing the package includes/)).toBeInTheDocument();
    expect(api.find("POST", "/api/packages")).toHaveLength(0);

    await u.type(screen.getByLabelText(/^Package name/), "Wedding Photography Package");
    await u.type(screen.getByLabelText(/^Description/), "Full-day coverage of your wedding.");
    await u.type(
      screen.getByLabelText(/^What’s included/),
      "Event coverage{enter}Edited photographs{enter}{enter}Digital gallery",
    );
    await u.click(screen.getByRole("button", { name: "Save package" }));

    expect(await screen.findByText(/Package saved\./)).toBeInTheDocument();
    expect(api.find("POST", "/api/packages")[0]!.body).toEqual({
      name: "Wedding Photography Package",
      description: "Full-day coverage of your wedding.",
      includes: ["Event coverage", "Edited photographs", "Digital gallery"],
      startingPriceKes: null,
    });
  });

  it("parses a price with separators and rejects nonsense", async () => {
    const api = mockApi({
      ...seller,
      "GET /api/packages": { body: listBody([]) },
      "POST /api/packages": { status: 201, body: pkg() },
    });
    const u = userEvent.setup();
    renderApp("/seller/packages", client());
    await u.click(await screen.findByRole("button", { name: "Add a package" }));
    await u.type(screen.getByLabelText(/^Package name/), "Birthday Cake Package");
    await u.type(screen.getByLabelText(/^Description/), "Custom cake design and decoration.");
    await u.type(screen.getByLabelText(/^What’s included/), "Custom cake design");
    await u.type(screen.getByLabelText(/^Starting price/), "free");
    await u.click(screen.getByRole("button", { name: "Save package" }));
    expect(await screen.findByText(/Enter the price as a number/)).toBeInTheDocument();

    await u.clear(screen.getByLabelText(/^Starting price/));
    await u.type(screen.getByLabelText(/^Starting price/), "4,500");
    await u.click(screen.getByRole("button", { name: "Save package" }));
    await waitFor(() => expect(api.find("POST", "/api/packages")).toHaveLength(1));
    expect(api.find("POST", "/api/packages")[0]!.body).toMatchObject({ startingPriceKes: 4500 });
  });

  it("edits a live package without touching the live version, and submits it for review", async () => {
    const live = pkg({ reviewState: "APPROVED", hasPublishedVersion: true, published: view() });
    const edited = pkg({
      reviewState: "DRAFT",
      hasPublishedVersion: true,
      published: view(),
      draft: view({ name: "Premium Wedding Package" }),
    });
    let current = live;
    const api = mockApi({
      ...seller,
      "GET /api/packages": () => ({ body: listBody([current]) }),
      "PATCH /api/packages/p1": () => {
        current = edited;
        return { body: edited };
      },
      "POST /api/packages/p1/submit": () => {
        current = { ...edited, reviewState: "PENDING", editable: false };
        return { body: current };
      },
    });
    const u = userEvent.setup();
    renderApp("/seller/packages", client());
    await u.click(await screen.findByRole("button", { name: "Edit" }));
    const name = screen.getByLabelText(/^Package name/);
    await u.clear(name);
    await u.type(name, "Premium Wedding Package");
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Live version unchanged")).toBeInTheDocument();
    expect(api.find("PATCH", "/api/packages/p1")[0]!.body).toMatchObject({
      name: "Premium Wedding Package",
    });

    await u.click(await screen.findByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(api.find("POST", "/api/packages/p1/submit")).toHaveLength(1));
  });

  it("locks a package that is awaiting review", async () => {
    mockApi({
      ...seller,
      "GET /api/packages": { body: listBody([pkg({ reviewState: "PENDING", editable: false })]) },
    });
    const u = userEvent.setup();
    renderApp("/seller/packages", client());
    await u.click(await screen.findByRole("button", { name: "View" }));
    expect(screen.getByLabelText(/^Package name/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("archives only after confirmation", async () => {
    const api = mockApi({
      ...seller,
      "GET /api/packages": { body: listBody([pkg()]) },
      "POST /api/packages/p1/archive": { body: pkg({ status: "ARCHIVED" }) },
    });
    const u = userEvent.setup();
    renderApp("/seller/packages", client());
    await u.click(
      await screen.findByRole("button", { name: "Archive Wedding Photography Package" }),
    );
    expect(api.find("POST", "/api/packages/p1/archive")).toHaveLength(0);
    await u.click(screen.getByRole("button", { name: "Yes, archive" }));
    await waitFor(() => expect(api.find("POST", "/api/packages/p1/archive")).toHaveLength(1));
  });

  it("uploads an optional photo, refusing unsupported files first", async () => {
    const api = mockApi({
      ...seller,
      "GET /api/packages": { body: listBody([pkg()]) },
      "POST /api/packages/p1/image-upload": {
        status: 201,
        body: { path: "businesses/b1/packages/p1/x.jpg", uploadUrl: "u", token: "tok" },
      },
      "POST /api/packages/p1/image": {
        body: pkg({
          draft: view({
            image: { url: "https://img.test/p.jpg", srcSet: null, width: 800, height: 600 },
          }),
        }),
      },
    });
    const u = userEvent.setup({ applyAccept: false });
    renderApp("/seller/packages", client());
    await u.click(await screen.findByRole("button", { name: "Edit" }));

    const input = screen.getByLabelText("Package photo");
    await u.upload(input, new File([new Uint8Array(10)], "notes.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/only JPEG, PNG or WebP/)).toBeInTheDocument();
    expect(api.find("POST", "/api/packages/p1/image-upload")).toHaveLength(0);

    await u.upload(input, new File([new Uint8Array(2048)], "team.jpg", { type: "image/jpeg" }));
    await waitFor(() =>
      expect(uploads.uploadToStorage).toHaveBeenCalledWith(
        "businesses/b1/packages/p1/x.jpg",
        "tok",
        expect.any(File),
      ),
    );
    await waitFor(() => expect(api.find("POST", "/api/packages/p1/image")).toHaveLength(1));
  });
});

describe("admin package review", () => {
  const admin = { "GET /api/me": user("ADMIN") };
  const adminClient = () => createFakeAuth(fakeSession("admin@kreatespace.test")).client;

  const detail = (reviewState: string, overrides: Record<string, unknown> = {}) => ({
    package: {
      id: "p1",
      status: "ACTIVE",
      reviewState,
      submittedAt: "2026-10-19",
      publishedAt: null,
    },
    business: { id: "b1", slug: "lens-works", name: "Lens Works", status: "APPROVED" },
    draft: view({ startingPriceKes: 80000 }),
    published: null,
    decisions: [],
    ...overrides,
  });

  it("defaults the list to packages awaiting review", async () => {
    const api = mockApi({
      ...admin,
      "GET /api/admin/packages": {
        body: {
          items: [
            {
              id: "p1",
              name: "Wedding Photography Package",
              status: "ACTIVE",
              reviewState: "PENDING",
              businessId: "b1",
              businessName: "Lens Works",
              submittedAt: null,
              updatedAt: "2026-10-19T08:00:00.000Z",
            },
          ],
          total: 1,
          pageSize: 20,
        },
      },
    });
    renderApp("/admin/packages", adminClient());
    expect(
      await screen.findByRole("link", { name: "Wedding Photography Package" }),
    ).toHaveAttribute("href", "/admin/packages/p1");
    expect(api.calls.find((c) => c.path.startsWith("/api/admin/packages"))!.path).toContain(
      "state=PENDING",
    );
    expect(screen.getByRole("navigation", { name: "Admin sections" })).toHaveTextContent(
      "Packages",
    );
  });

  it("shows the package, approves it and then offers suspension", async () => {
    const api = mockApi({
      ...admin,
      "GET /api/admin/packages/p1": { body: detail("PENDING") },
      "POST /api/admin/packages/p1/decision": {
        body: detail("APPROVED", {
          package: {
            id: "p1",
            status: "ACTIVE",
            reviewState: "APPROVED",
            submittedAt: null,
            publishedAt: "2026-10-20",
          },
        }),
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/packages/p1", adminClient());
    const section = await screen.findByRole("region", { name: "Submission to review" });
    expect(within(section).getByText("KSh 80,000")).toBeInTheDocument();
    expect(within(section).getByText("Edited photographs")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("button", { name: "Suspend package" })).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/packages/p1/decision")[0]!.body).toEqual({
      action: "APPROVE",
    });
  });

  it("requires a reason to reject", async () => {
    const api = mockApi({ ...admin, "GET /api/admin/packages/p1": { body: detail("PENDING") } });
    const u = userEvent.setup();
    renderApp("/admin/packages/p1", adminClient());
    await u.click(await screen.findByRole("button", { name: "Reject" }));
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/packages/p1/decision")).toHaveLength(0);
  });

  it("compares an edit with the live version", async () => {
    mockApi({
      ...admin,
      "GET /api/admin/packages/p1": {
        body: detail("PENDING", {
          published: view({ name: "Old name" }),
          draft: view({ name: "New name" }),
        }),
      },
    });
    renderApp("/admin/packages/p1", adminClient());
    expect(await screen.findByRole("region", { name: "Currently live" })).toHaveTextContent(
      "Old name",
    );
    expect(screen.getByRole("region", { name: "Submission to review" })).toHaveTextContent(
      "New name",
    );
    expect(screen.getByText(/current version stays public until you approve/)).toBeInTheDocument();
  });

  it("handles a package that doesn't exist", async () => {
    mockApi({
      ...admin,
      "GET /api/admin/packages/p1": {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "x" } },
      },
    });
    renderApp("/admin/packages/p1", adminClient());
    expect(await screen.findByText("This package doesn’t exist.")).toBeInTheDocument();
  });
});
