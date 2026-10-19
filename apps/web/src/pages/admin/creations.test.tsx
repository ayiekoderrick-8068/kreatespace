import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, user } from "../../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../../test/renderWithProviders";

const adminClient = () => createFakeAuth(fakeSession("admin@kreatespace.test")).client;
const CATEGORY = { id: "c1", slug: "cakes", name: "Cakes" };

const image = (n: number) => ({
  id: `i${n}`,
  position: n - 1,
  width: 800,
  height: 1000,
  url: `https://img.test/${n}.jpg`,
});

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    version: 1,
    status: "PENDING",
    title: "Floral Birthday Cake",
    description: "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
    category: CATEGORY,
    occasion: { id: "o1", slug: "birthday", name: "Birthday" },
    submittedAt: "2026-10-19T08:00:00.000Z",
    images: [image(1), image(2)],
    ...overrides,
  };
}

function detail(status: string, overrides: Record<string, unknown> = {}) {
  return {
    creation: { id: "c1", status, createdAt: "2026-10-19", publishedAt: null },
    business: { id: "b1", slug: "cakes-by-maria", name: "Cakes by Maria", status: "APPROVED" },
    reviewRevision: revision(),
    publishedRevision: null,
    revisions: [
      { id: "r1", version: 1, status: "PENDING", submittedAt: "2026-10-19T08:00:00.000Z" },
    ],
    decisions: [],
    ...overrides,
  };
}

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  status: "PENDING",
  title: "Floral Birthday Cake",
  categoryName: "Cakes",
  businessId: "b1",
  businessName: "Cakes by Maria",
  businessSlug: "cakes-by-maria",
  hasPendingSubmission: true,
  pendingSubmittedAt: "2026-10-19T08:00:00.000Z",
  updatedAt: "2026-10-19T08:00:00.000Z",
  ...overrides,
});

const baseRoutes = {
  "GET /api/me": user("ADMIN"),
  "GET /api/public/filters": {
    body: {
      categories: [
        { slug: "cakes", name: "Cakes" },
        { slug: "flowers", name: "Flowers" },
      ],
      occasions: [],
    },
  },
};

describe("admin creation list", () => {
  it("is closed to sellers", async () => {
    mockApi({ "GET /api/me": user("SELLER") });
    renderApp("/admin/creations", adminClient());
    expect(
      await screen.findByRole("heading", { name: "You don’t have access to this page" }),
    ).toBeInTheDocument();
  });

  it("lists submissions and links to the review page", async () => {
    mockApi({
      ...baseRoutes,
      "GET /api/admin/creations": {
        body: {
          items: [
            item(),
            item({
              id: "c2",
              title: "Rose Bouquet",
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
    renderApp("/admin/creations", adminClient());
    expect(await screen.findByRole("link", { name: "Floral Birthday Cake" })).toHaveAttribute(
      "href",
      "/admin/creations/c1",
    );
    expect(screen.getByText("2 creations")).toBeInTheDocument();
    expect(screen.getByText("Update awaiting review")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Admin sections" })).toHaveTextContent(
      "Creations",
    );
  });

  it("filters by status, category, business and search, sending each to the API", async () => {
    const api = mockApi({
      ...baseRoutes,
      "GET /api/admin/creations": { body: { items: [item()], total: 1, page: 1, pageSize: 20 } },
    });
    const u = userEvent.setup();
    renderApp("/admin/creations", adminClient());
    await screen.findByRole("link", { name: "Floral Birthday Cake" });

    await u.selectOptions(screen.getByLabelText("Filter by status"), "PENDING");
    await u.selectOptions(await screen.findByLabelText("Filter by category"), "flowers");
    await u.click(screen.getByRole("button", { name: "Cakes by Maria" }));
    await u.type(screen.getByLabelText("Search submissions"), "roses");
    await u.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      const last = new URL(
        api.calls.filter((c) => c.path.startsWith("/api/admin/creations")).at(-1)!.path,
        "http://x",
      );
      expect(last.searchParams.get("status")).toBe("PENDING");
      expect(last.searchParams.get("category")).toBe("flowers");
      expect(last.searchParams.get("businessId")).toBe("b1");
      expect(last.searchParams.get("q")).toBe("roses");
    });
    expect(screen.getByText(/Showing one business’s creations/)).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mockApi({
      ...baseRoutes,
      "GET /api/admin/creations": { body: { items: [], total: 0, page: 1, pageSize: 20 } },
    });
    renderApp("/admin/creations", adminClient());
    expect(await screen.findByText("No creations match these filters.")).toBeInTheDocument();
  });
});

describe("admin creation review", () => {
  const setup = (body: unknown, decisionResult?: unknown, extra: Record<string, unknown> = {}) =>
    mockApi({
      ...baseRoutes,
      "GET /api/admin/creations/c1": { body },
      "POST /api/admin/creations/c1/decision": { body: decisionResult ?? body },
      ...extra,
    } as Parameters<typeof mockApi>[0]);

  it("shows the submitted details and photos", async () => {
    setup(detail("PENDING"));
    renderApp("/admin/creations/c1", adminClient());
    const section = await screen.findByRole("region", { name: "Submission to review" });
    expect(within(section).getByText("Cakes · Birthday")).toBeInTheDocument();
    expect(
      within(section).getByText(
        "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
      ),
    ).toBeInTheDocument();
    expect(within(section).getAllByRole("img")).toHaveLength(2);
    expect(within(section).getByAltText("Photo 1")).toHaveAttribute(
      "src",
      "https://img.test/1.jpg",
    );
    expect(screen.getByText(/business is approved/)).toBeInTheDocument();
  });

  it("approves a pending creation, guarding against stale views", async () => {
    const api = setup(
      detail("PENDING"),
      detail("APPROVED", { reviewRevision: revision({ status: "APPROVED" }) }),
    );
    const u = userEvent.setup();
    renderApp("/admin/creations/c1", adminClient());
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(api.find("POST", "/api/admin/creations/c1/decision")).toHaveLength(1),
    );
    expect(api.find("POST", "/api/admin/creations/c1/decision")[0]!.body).toEqual({
      action: "APPROVE",
      revisionId: "r1",
    });
    expect(await screen.findByRole("button", { name: "Suspend creation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it.each([
    ["Request changes", "REQUEST_CHANGES"],
    ["Reject", "REJECT"],
  ])("requires a reason before %s", async (label, action) => {
    const api = setup(detail("PENDING"));
    const u = userEvent.setup();
    renderApp("/admin/creations/c1", adminClient());
    await u.click(await screen.findByRole("button", { name: label }));
    expect(
      await screen.findByText(/Explain your decision in at least 10 characters/),
    ).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/creations/c1/decision")).toHaveLength(0);

    await u.type(
      screen.getByLabelText(/Reason or feedback/),
      "The photos are too dark to judge quality.",
    );
    await u.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(api.find("POST", "/api/admin/creations/c1/decision")).toHaveLength(1),
    );
    expect(api.find("POST", "/api/admin/creations/c1/decision")[0]!.body).toMatchObject({
      action,
      reason: "The photos are too dark to judge quality.",
    });
  });

  it("shows the server's error, such as a decision already made", async () => {
    setup(detail("PENDING"), undefined, {
      "POST /api/admin/creations/c1/decision": {
        status: 409,
        body: {
          error: { code: "NOTHING_TO_REVIEW", message: "This submission was already reviewed" },
        },
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/creations/c1", adminClient());
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This submission was already reviewed",
    );
  });

  it("compares an edit with the live version, and explains approving it", async () => {
    setup(
      detail("APPROVED", {
        reviewRevision: revision({ id: "r2", version: 2, title: "Premium Floral Cake" }),
        publishedRevision: revision({ status: "APPROVED" }),
      }),
    );
    renderApp("/admin/creations/c1", adminClient());
    expect(await screen.findByRole("region", { name: "Currently live" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Submission to review" })).toHaveTextContent(
      "Premium Floral Cake",
    );
    expect(screen.getByText(/current version stays public until you approve/)).toBeInTheDocument();
  });

  it("suspends a live creation with a reason and can reinstate it", async () => {
    const api = setup(
      detail("APPROVED", { reviewRevision: revision({ status: "APPROVED" }) }),
      detail("SUSPENDED", { reviewRevision: revision({ status: "APPROVED" }) }),
    );
    const u = userEvent.setup();
    renderApp("/admin/creations/c1", adminClient());
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    await u.type(
      await screen.findByLabelText(/Reason or feedback/),
      "Reported as misleading by a customer.",
    );
    await u.click(screen.getByRole("button", { name: "Suspend creation" }));
    expect(await screen.findByRole("button", { name: "Reinstate creation" })).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/creations/c1/decision")[0]!.body).toMatchObject({
      action: "SUSPEND",
    });
  });

  it("shows the moderation history with the deciding admin", async () => {
    setup(
      detail("CHANGES_REQUESTED", {
        reviewRevision: revision({ status: "CHANGES_REQUESTED" }),
        decisions: [
          {
            id: "d1",
            action: "CHANGES_REQUESTED",
            reason: "Add a clearer photo.",
            createdAt: "2026-10-20T08:00:00.000Z",
            revisionId: "r1",
            admin: { id: "a1", email: "admin@kreatespace.test", fullName: "Derrick" },
          },
        ],
      }),
    );
    renderApp("/admin/creations/c1", adminClient());
    const history = await screen.findByRole("region", { name: "Decision history" });
    expect(within(history).getByText("Changes requested")).toBeInTheDocument();
    expect(within(history).getByText(/Derrick/)).toBeInTheDocument();
    expect(within(history).getByText("Add a clearer photo.")).toBeInTheDocument();
    expect(screen.getByText(/nothing to review right now/i)).toBeInTheDocument();
  });

  it("handles a creation that doesn't exist", async () => {
    mockApi({
      ...baseRoutes,
      "GET /api/admin/creations/c1": {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "Creation not found" } },
      },
    });
    renderApp("/admin/creations/c1", adminClient());
    expect(await screen.findByText("This creation doesn’t exist.")).toBeInTheDocument();
  });
});
