import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, user } from "../../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../../test/renderWithProviders";

const CATEGORY = { id: "c1", slug: "cakes", name: "Cakes" };

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    version: 1,
    status: "PENDING",
    businessName: "Cakes by Maria",
    ownerName: "Maria Wanjiku",
    description: "Custom celebration cakes baked fresh to order in Nairobi.",
    category: CATEGORY,
    county: "Nairobi",
    city: "Westlands",
    websiteUrl: null,
    whatsappNumber: "+254712345678",
    logoPath: null,
    logoUrl: null,
    images: [{ path: "businesses/b1/p1.jpg", url: "https://storage.test/p1.jpg" }],
    termsAccepted: true,
    contentAuthorized: true,
    submittedAt: "2026-10-19T08:00:00.000Z",
    ...overrides,
  };
}

function detail(status: string, overrides: Record<string, unknown> = {}) {
  return {
    business: {
      id: "b1",
      slug: "cakes-by-maria",
      status,
      createdAt: "2026-10-19T08:00:00.000Z",
      owner: { id: "u1", email: "maria@example.com", fullName: "Maria Wanjiku" },
    },
    reviewRevision: revision(),
    publishedRevision: null,
    revisions: [
      { id: "r1", version: 1, status: "PENDING", submittedAt: "2026-10-19T08:00:00.000Z" },
    ],
    decisions: [],
    ...overrides,
  };
}

const listItem = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  slug: "cakes-by-maria",
  status: "PENDING",
  businessName: "Cakes by Maria",
  ownerName: "Maria Wanjiku",
  ownerEmail: "maria@example.com",
  categoryName: "Cakes",
  county: "Nairobi",
  city: "Westlands",
  hasPendingSubmission: true,
  pendingSubmittedAt: "2026-10-19T08:00:00.000Z",
  updatedAt: "2026-10-19T08:00:00.000Z",
  ...overrides,
});

const adminClient = () => createFakeAuth(fakeSession("admin@kreatespace.test")).client;

describe("admin business list", () => {
  it("is closed to sellers", async () => {
    mockApi({ "GET /api/me": user("SELLER") });
    renderApp("/admin/businesses", adminClient());
    expect(
      await screen.findByRole("heading", { name: "You don’t have access to this page" }),
    ).toBeInTheDocument();
  });

  it("lists applications with status and links to the review page", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/businesses?page=1": {
        body: {
          items: [
            listItem(),
            listItem({
              id: "b2",
              businessName: "Beta Blooms",
              status: "APPROVED",
              hasPendingSubmission: true,
            }),
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      },
    });
    renderApp("/admin", adminClient());

    const link = await screen.findByRole("link", { name: "Cakes by Maria" });
    expect(link).toHaveAttribute("href", "/admin/businesses/b1");
    expect(screen.getByText("2 businesses")).toBeInTheDocument();
    expect(screen.getByText("Update awaiting review")).toBeInTheDocument();
    expect(screen.getAllByText("maria@example.com").length).toBeGreaterThan(0);
  });

  it("filters by status and searches, sending both to the API", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/businesses": {
        body: { items: [listItem()], total: 1, page: 1, pageSize: 20 },
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/businesses", adminClient());
    await screen.findByRole("link", { name: "Cakes by Maria" });

    await u.selectOptions(screen.getByLabelText("Filter by status"), "PENDING");
    await waitFor(() =>
      expect(api.calls.some((c) => c.path.includes("status=PENDING"))).toBe(true),
    );

    await u.type(screen.getByLabelText("Search applications"), "kisumu");
    await u.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.path.includes("q=kisumu") && c.path.includes("status=PENDING")),
      ).toBe(true),
    );
  });

  it("shows an empty state", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/businesses": { body: { items: [], total: 0, page: 1, pageSize: 20 } },
    });
    renderApp("/admin/businesses", adminClient());
    expect(await screen.findByText("No applications match these filters.")).toBeInTheDocument();
  });

  it("paginates", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/businesses": {
        body: { items: [listItem()], total: 45, page: 1, pageSize: 20 },
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/businesses", adminClient());
    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.calls.some((c) => c.path.includes("page=2"))).toBe(true));
  });
});

describe("admin review page", () => {
  function setupDetail(body: unknown, decisionResult?: unknown) {
    return mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/businesses": { body: { items: [], total: 0, page: 1, pageSize: 20 } },
      "GET /api/admin/businesses/b1": { body },
      "POST /api/admin/businesses/b1/decision": { body: decisionResult ?? body },
    });
  }

  it("shows all submitted information and photos", async () => {
    setupDetail(detail("PENDING"));
    renderApp("/admin/businesses/b1", adminClient());
    expect(
      await screen.findByRole("heading", { name: "Cakes by Maria", level: 2 }),
    ).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Submission to review" });
    expect(within(section).getByText("Westlands, Nairobi")).toBeInTheDocument();
    expect(within(section).getByText("+254712345678")).toBeInTheDocument();
    expect(within(section).getByText("No website")).toBeInTheDocument();
    expect(within(section).getByAltText("Portfolio photo 1")).toHaveAttribute(
      "src",
      "https://storage.test/p1.jpg",
    );
    expect(screen.getByText(/maria@example.com/)).toBeInTheDocument();
  });

  it("approves a pending application", async () => {
    const api = setupDetail(
      detail("PENDING"),
      detail("APPROVED", { reviewRevision: revision({ status: "APPROVED" }) }),
    );
    const u = userEvent.setup();
    renderApp("/admin/businesses/b1", adminClient());
    await u.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(api.find("POST", "/api/admin/businesses/b1/decision")).toHaveLength(1),
    );
    expect(api.find("POST", "/api/admin/businesses/b1/decision")[0]!.body).toEqual({
      action: "APPROVE",
      revisionId: "r1",
    });
    expect(await screen.findByRole("button", { name: "Suspend business" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it.each([
    ["Request changes", "REQUEST_CHANGES"],
    ["Reject", "REJECT"],
  ])("requires a reason before %s", async (label, action) => {
    const api = setupDetail(detail("PENDING"));
    const u = userEvent.setup();
    renderApp("/admin/businesses/b1", adminClient());

    await u.click(await screen.findByRole("button", { name: label }));
    expect(
      await screen.findByText(/Explain your decision in at least 10 characters/),
    ).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/businesses/b1/decision")).toHaveLength(0);

    await u.type(
      screen.getByLabelText(/Reason or feedback/),
      "Photos are too dark to judge quality.",
    );
    await u.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(api.find("POST", "/api/admin/businesses/b1/decision")).toHaveLength(1),
    );
    expect(api.find("POST", "/api/admin/businesses/b1/decision")[0]!.body).toMatchObject({
      action,
      reason: "Photos are too dark to judge quality.",
    });
  });

  it("shows the server's error, such as a decision already made by another admin", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/businesses/b1": { body: detail("PENDING") },
      "POST /api/admin/businesses/b1/decision": {
        status: 409,
        body: {
          error: { code: "NOTHING_TO_REVIEW", message: "This submission was already reviewed" },
        },
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/businesses/b1", adminClient());
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This submission was already reviewed",
    );
  });

  it("suspends an approved business with a reason, and reinstates a suspended one", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/businesses/b1": {
        body: detail("APPROVED", { reviewRevision: revision({ status: "APPROVED" }) }),
      },
      "POST /api/admin/businesses/b1/decision": {
        body: detail("SUSPENDED", { reviewRevision: revision({ status: "APPROVED" }) }),
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/businesses/b1", adminClient());

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await u.type(
      await screen.findByLabelText(/Reason or feedback/),
      "Reported for misleading photos.",
    );
    await u.click(screen.getByRole("button", { name: "Suspend business" }));
    expect(await screen.findByRole("button", { name: "Reinstate business" })).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/businesses/b1/decision")[0]!.body).toMatchObject({
      action: "SUSPEND",
      reason: "Reported for misleading photos.",
    });
  });

  it("compares a pending update with the live profile", async () => {
    setupDetail(
      detail("APPROVED", {
        reviewRevision: revision({ id: "r2", version: 2, businessName: "Maria’s Luxury Cakes" }),
        publishedRevision: revision({ status: "APPROVED" }),
      }),
    );
    renderApp("/admin/businesses/b1", adminClient());
    expect(await screen.findByRole("region", { name: "Currently live" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Submission to review" })).toBeInTheDocument();
    expect(screen.getByText(/current profile stays public until you approve/)).toBeInTheDocument();
  });

  it("shows the decision history with the deciding admin", async () => {
    setupDetail(
      detail("CHANGES_REQUESTED", {
        reviewRevision: revision({ status: "CHANGES_REQUESTED" }),
        decisions: [
          {
            id: "d1",
            action: "CHANGES_REQUESTED",
            reason: "Add a clearer logo.",
            createdAt: "2026-10-20T08:00:00.000Z",
            revisionId: "r1",
            admin: { id: "a1", email: "admin@kreatespace.test", fullName: "Derrick" },
          },
        ],
      }),
    );
    renderApp("/admin/businesses/b1", adminClient());
    const history = await screen.findByRole("region", { name: "Decision history" });
    expect(within(history).getByText("Changes requested")).toBeInTheDocument();
    expect(within(history).getByText(/Derrick/)).toBeInTheDocument();
    expect(within(history).getByText("Add a clearer logo.")).toBeInTheDocument();
    expect(screen.getByText(/nothing to review right now/i)).toBeInTheDocument();
  });

  it("handles businesses that do not exist", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/businesses/b1": {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "Business not found" } },
      },
    });
    renderApp("/admin/businesses/b1", adminClient());
    expect(await screen.findByText("This business doesn’t exist.")).toBeInTheDocument();
  });
});
