import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, user } from "../../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../../test/renderWithProviders";

const CATEGORY = { id: "11111111-1111-4111-8111-111111111111", slug: "cakes", name: "Cakes" };

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    version: 1,
    status: "APPROVED",
    businessName: "Cakes by Maria",
    ownerName: "Maria Wanjiku",
    description: "Custom celebration cakes baked fresh to order in Nairobi.",
    category: CATEGORY,
    county: "Nairobi",
    city: "Westlands",
    websiteUrl: "https://cakes-by-maria.vercel.app",
    whatsappNumber: "+254712345678",
    logoPath: null,
    logoUrl: null,
    images: [],
    termsAccepted: true,
    contentAuthorized: true,
    submittedAt: "2026-10-19T08:00:00.000Z",
    ...overrides,
  };
}

function own(
  status: string,
  options: {
    revision?: Record<string, unknown>;
    published?: Record<string, unknown> | null;
    decisions?: unknown[];
  } = {},
) {
  return {
    business: { id: "b1", slug: "cakes-by-maria", status, createdAt: "2026-10-19" },
    revision: revision({
      status: status === "APPROVED" ? "APPROVED" : status,
      ...options.revision,
    }),
    publishedRevision: options.published ?? null,
    decisions: options.decisions ?? [],
  };
}

const decision = (action: string, reason: string | null) => ({
  id: `d-${action}`,
  action,
  reason,
  createdAt: "2026-10-20T08:00:00.000Z",
  revisionId: "r1",
});

function renderDashboard(body: unknown | null) {
  const api = mockApi({
    "GET /api/me": user("SELLER"),
    "GET /api/businesses/me":
      body === null
        ? { status: 404, body: { error: { code: "NOT_FOUND", message: "none" } } }
        : { body },
  });
  renderApp("/seller", createFakeAuth(fakeSession()).client);
  return api;
}

describe("seller dashboard", () => {
  it("invites a new seller to start their application", async () => {
    renderDashboard(null);
    const link = await screen.findByRole("link", { name: "Start your application" });
    expect(link).toHaveAttribute("href", "/seller/register");
  });

  it("lets a seller resume a draft", async () => {
    renderDashboard(own("DRAFT"));
    expect(await screen.findByRole("link", { name: "Continue application" })).toHaveAttribute(
      "href",
      "/seller/register",
    );
  });

  it("tells a seller their application is being reviewed", async () => {
    renderDashboard(own("PENDING"));
    expect(await screen.findByText("We’re reviewing your application")).toBeInTheDocument();
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edit profile/ })).not.toBeInTheDocument();
  });

  it("shows the admin's feedback when changes are requested", async () => {
    renderDashboard(
      own("CHANGES_REQUESTED", {
        decisions: [decision("CHANGES_REQUESTED", "Please add clearer photos of your cakes.")],
      }),
    );
    expect(await screen.findByText("Changes needed")).toBeInTheDocument();
    const feedback = screen.getByText("Feedback from our team").closest("blockquote")!;
    expect(
      within(feedback).getByText("Please add clearer photos of your cakes."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Update your application" })).toHaveAttribute(
      "href",
      "/seller/register",
    );
  });

  it("explains a rejection with the reason", async () => {
    renderDashboard(
      own("REJECTED", { decisions: [decision("REJECTED", "We can’t verify this business.")] }),
    );
    expect(await screen.findByText("Application not approved")).toBeInTheDocument();
    expect(screen.getAllByText("We can’t verify this business.").length).toBeGreaterThan(0);
  });

  it("explains a suspension", async () => {
    renderDashboard(
      own("SUSPENDED", { decisions: [decision("SUSPENDED", "Reported for misleading photos.")] }),
    );
    expect(await screen.findByText("Your business is suspended")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edit profile/ })).not.toBeInTheDocument();
  });

  it("shows an approved seller their live profile and next steps", async () => {
    renderDashboard(own("APPROVED", { decisions: [decision("APPROVED", null)] }));
    expect(await screen.findByText("Your public profile")).toBeInTheDocument();
    expect(screen.getByText("Westlands, Nairobi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://cakes-by-maria.vercel.app" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "/businesses/cakes-by-maria" })).toHaveAttribute(
      "href",
      "/businesses/cakes-by-maria",
    );
    expect(screen.getByRole("link", { name: "Edit profile" })).toHaveAttribute(
      "href",
      "/seller/edit",
    );
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("shows no-website sellers honestly", async () => {
    renderDashboard(own("APPROVED", { revision: { websiteUrl: null } }));
    expect(await screen.findByText("No website")).toBeInTheDocument();
  });

  it("keeps the live profile visible while an update is in review", async () => {
    renderDashboard(
      own("APPROVED", {
        revision: { id: "r2", version: 2, status: "PENDING", businessName: "Maria’s Luxury Cakes" },
        published: revision({ businessName: "Cakes by Maria" }),
      }),
    );
    expect(await screen.findByText("Your public profile")).toBeInTheDocument();
    expect(screen.getByText("Cakes by Maria", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByText("Maria’s Luxury Cakes", { selector: "dd" })).not.toBeInTheDocument();
    expect(screen.getByText("Profile update")).toBeInTheDocument();
    expect(screen.getByText(/stays live until/)).toBeInTheDocument();
  });

  it("shows feedback on a rejected update", async () => {
    renderDashboard(
      own("APPROVED", {
        revision: { id: "r2", version: 2, status: "REJECTED" },
        published: revision(),
        decisions: [decision("REJECTED", "The new name is confusing.")],
      }),
    );
    expect(await screen.findByText(/have not been published/)).toBeInTheDocument();
    expect(screen.getAllByText("The new name is confusing.").length).toBeGreaterThan(0);
  });
});

describe("editing an approved profile", () => {
  it("starts a draft revision only when the seller asks", async () => {
    let started = false;
    const api = mockApi({
      "GET /api/me": user("SELLER"),
      "GET /api/categories": { body: { categories: [CATEGORY] } },
      "GET /api/businesses/me": () =>
        started
          ? {
              body: own("APPROVED", {
                revision: { id: "r2", version: 2, status: "DRAFT", businessName: "Cakes by Maria" },
                published: revision(),
              }),
            }
          : { body: own("APPROVED") },
      "POST /api/businesses/me/revisions": () => {
        started = true;
        return { status: 201, body: own("APPROVED") };
      },
    });
    const u = userEvent.setup();
    renderApp("/seller/edit", createFakeAuth(fakeSession()).client);

    await screen.findByRole("heading", { name: "Edit your profile" });
    expect(api.find("POST", "/api/businesses/me/revisions")).toHaveLength(0);

    await u.click(screen.getByRole("button", { name: "Start editing" }));
    expect(await screen.findByRole("heading", { name: "Update your profile" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Business name/)).toHaveValue("Cakes by Maria");
    expect(screen.getByText(/current profile stays live/i)).toBeInTheDocument();
    await waitFor(() => expect(api.find("POST", "/api/businesses/me/revisions")).toHaveLength(1));
  });

  it("blocks edits while an update is in review", async () => {
    mockApi({
      "GET /api/me": user("SELLER"),
      "GET /api/businesses/me": {
        body: own("APPROVED", {
          revision: { id: "r2", version: 2, status: "PENDING" },
          published: revision(),
        }),
      },
    });
    renderApp("/seller/edit", createFakeAuth(fakeSession()).client);
    expect(await screen.findByRole("heading", { name: "Update in review" })).toBeInTheDocument();
  });

  it("sends sellers who are not approved back to the dashboard", async () => {
    mockApi({
      "GET /api/me": user("SELLER"),
      "GET /api/businesses/me": { body: own("PENDING") },
    });
    renderApp("/seller/edit", createFakeAuth(fakeSession()).client);
    expect(await screen.findByText("We’re reviewing your application")).toBeInTheDocument();
  });
});
