import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, user } from "../../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../../test/renderWithProviders";

const client = () => createFakeAuth(fakeSession()).client;

const sellerEffects = {
  role: "SELLER",
  savedCreations: 2,
  business: {
    name: "Maria Cakes",
    status: "APPROVED",
    creations: 9,
    packages: 3,
    openWebsiteRequests: 1,
    importInProgress: false,
  },
};

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "d1",
  status: "REQUESTED",
  requestedAt: "2026-10-10T08:00:00.000Z",
  scheduledFor: "2026-10-24T08:00:00.000Z",
  needsReview: true,
  reviewNote: null,
  completedAt: null,
  reviewedAt: null,
  cancelledAt: null,
  reviewedBy: null,
  roleAtRequest: "SELLER",
  effects: sellerEffects,
  summary: null,
  requester: "maria@example.com",
  history: [{ action: "account.deletion_requested", at: "2026-10-10T08:00:00.000Z" }],
  ...overrides,
});

const list = (items: unknown[], total = items.length) => ({
  body: { items, total, page: 1, pageSize: 20 },
});

describe("admin account deletions", () => {
  it("lists open requests with what deleting would remove", async () => {
    mockApi({ "GET /api/me": user("ADMIN"), "GET /api/admin/deletions": list([entry()]) });
    renderApp("/admin/deletions", client());

    const requests = await screen.findByRole("list", { name: "Account deletion requests" });
    expect(within(requests).getByText("maria@example.com")).toBeInTheDocument();
    expect(within(requests).getByText("Business owner", { exact: false })).toBeInTheDocument();
    expect(
      within(requests).getByText("Needs your decision. Nothing happens until you approve."),
    ).toBeInTheDocument();
    expect(within(requests).getByText("Maria Cakes · approved")).toBeInTheDocument();
    expect(within(requests).getByText("9")).toBeInTheDocument(); // creations
    expect(within(requests).getByText("None running")).toBeInTheDocument();
  });

  it("is reachable from the admin navigation", async () => {
    mockApi({ "GET /api/me": user("ADMIN"), "GET /api/admin/deletions": list([]) });
    renderApp("/admin/deletions", client());
    expect(await screen.findByRole("link", { name: "Deletions" })).toHaveAttribute(
      "href",
      "/admin/deletions",
    );
    expect(await screen.findByText("No requests match this filter.")).toBeInTheDocument();
  });

  it("asks for confirmation before approving, and says nothing is deleted yet", async () => {
    let approved = false;
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/deletions": () => list(approved ? [] : [entry()]),
      "POST /api/admin/deletions/d1/decision": () => {
        approved = true;
        return { body: { ok: true } };
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/deletions", client());

    await u.click(await screen.findByRole("button", { name: "Approve deletion…" }));
    const group = screen.getByRole("group", { name: "Confirm approval" });
    expect(within(group).getByText(/Approving does not delete anything now/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    await u.click(within(group).getByRole("button", { name: "Confirm approval" }));
    await waitFor(() =>
      expect(api.find("POST", "/api/admin/deletions/d1/decision")).toHaveLength(1),
    );
    expect(api.find("POST", "/api/admin/deletions/d1/decision")[0]!.body).toEqual({
      action: "APPROVE",
    });
    expect(await screen.findByText("No requests match this filter.")).toBeInTheDocument();
  });

  it("can back out of an approval without sending anything", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/deletions": list([entry()]),
    });
    const u = userEvent.setup();
    renderApp("/admin/deletions", client());
    await u.click(await screen.findByRole("button", { name: "Approve deletion…" }));
    await u.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Approve deletion…" })).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("will not refuse without a reason the person can read", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/deletions": list([entry()]),
      "POST /api/admin/deletions/d1/decision": { body: { ok: true } },
    });
    const u = userEvent.setup();
    renderApp("/admin/deletions", client());
    await u.click(await screen.findByRole("button", { name: "Refuse…" }));
    const send = screen.getByRole("button", { name: "Refuse request" });
    expect(send).toBeDisabled();
    await u.type(screen.getByLabelText(/Reason shown to the person/), "Unpaid website project");
    expect(send).toBeEnabled();
    await u.click(send);
    await waitFor(() =>
      expect(api.find("POST", "/api/admin/deletions/d1/decision")).toHaveLength(1),
    );
    expect(api.find("POST", "/api/admin/deletions/d1/decision")[0]!.body).toEqual({
      action: "REJECT",
      note: "Unpaid website project",
    });
  });

  it("shows the server's error when a decision is turned down", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/deletions": list([entry()]),
      "POST /api/admin/deletions/d1/decision": {
        status: 409,
        body: {
          error: {
            code: "DELETION_ALREADY_DECIDED",
            message: "This request is not waiting for a decision.",
          },
        },
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/deletions", client());
    await u.click(await screen.findByRole("button", { name: "Approve deletion…" }));
    await u.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not waiting for a decision");
  });

  it("offers no buttons for customer requests, which need no review", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/deletions": list([
        entry({
          needsReview: false,
          roleAtRequest: "CUSTOMER",
          effects: { role: "CUSTOMER", savedCreations: 4, business: null },
        }),
      ]),
    });
    renderApp("/admin/deletions", client());
    expect(
      await screen.findByText(/No review needed: carried out automatically/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve|Refuse/ })).not.toBeInTheDocument();
  });

  it("filters by status and shows the outcome and history of finished requests", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/deletions": list([entry()]),
      "GET /api/admin/deletions?status=COMPLETED&page=1": list([
        entry({
          status: "COMPLETED",
          completedAt: "2026-10-25T01:30:00.000Z",
          effects: null,
          requester: null,
          reviewedBy: "Admin Ann",
          summary: { creations: 9, packages: 3, filesRemoved: 41, hadBusiness: true },
          history: [
            { action: "account.deletion_requested", at: "2026-10-10T08:00:00.000Z" },
            { action: "account.deletion_approved", at: "2026-10-11T09:00:00.000Z" },
            { action: "account.deleted", at: "2026-10-25T01:30:00.000Z" },
          ],
        }),
      ]),
    });
    const u = userEvent.setup();
    renderApp("/admin/deletions", client());
    await screen.findByText("maria@example.com");
    await u.selectOptions(screen.getByLabelText("Filter requests by status"), "COMPLETED");

    expect(await screen.findByText("Account no longer exists")).toBeInTheDocument();
    expect(screen.getByText("Photos removed: 41")).toBeInTheDocument();
    expect(screen.getByText("Creations: 9")).toBeInTheDocument();
    expect(screen.queryByText(/hadBusiness/)).not.toBeInTheDocument();
    await u.click(screen.getByText("History"));
    expect(screen.getByText(/Approved by an administrator \(Admin Ann\)/)).toBeInTheDocument();
    expect(screen.getByText(/Account and records deleted/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve|Refuse/ })).not.toBeInTheDocument();
    expect(api.find("GET", "/api/admin/deletions?status=COMPLETED&page=1")).toHaveLength(1);
  });

  it("explains when the list cannot be loaded", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/deletions": { status: 500, body: { error: { code: "X", message: "Boom" } } },
    });
    renderApp("/admin/deletions", client());
    expect(await screen.findByText(/Couldn’t load deletion requests/)).toBeInTheDocument();
  });

  it("keeps everyone but administrators out", async () => {
    const api = mockApi({ "GET /api/me": user("CUSTOMER") });
    renderApp("/admin/deletions", client());
    await waitFor(() => expect(screen.queryByText("Account deletions")).not.toBeInTheDocument());
    expect(api.calls.some((c) => c.path.startsWith("/api/admin/deletions"))).toBe(false);
  });
});
