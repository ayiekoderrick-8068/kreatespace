import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { mockApi, user } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";

const TOKEN = "a".repeat(43);

beforeEach(() => {
  window.localStorage.clear();
});

describe("invitation page", () => {
  it("rejects malformed links without calling the API", async () => {
    const api = mockApi();
    renderApp("/invite/not-a-token", createFakeAuth().client);
    expect(await screen.findByText(/invitation link is invalid/i)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("explains unusable invitations", async () => {
    mockApi({ [`GET /api/invitations/lookup?token=${TOKEN}`]: { body: { valid: false } } });
    renderApp(`/invite/${TOKEN}`, createFakeAuth().client);
    expect(
      await screen.findByRole("heading", { name: "Invitation unavailable" }),
    ).toBeInTheDocument();
  });

  it("asks visitors to sign in or register, and remembers the link", async () => {
    mockApi({
      [`GET /api/invitations/lookup?token=${TOKEN}`]: {
        body: { valid: true, email: "maria@example.com" },
      },
    });
    renderApp(`/invite/${TOKEN}`, createFakeAuth().client);

    expect(
      await screen.findByText("This invitation is for maria@example.com."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(screen.getByRole("link", { name: "I already have an account" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(window.localStorage.getItem("kreatespace.pendingInvite")).toBe(TOKEN);
  });

  it("stops people who are signed in with a different email", async () => {
    mockApi({
      [`GET /api/invitations/lookup?token=${TOKEN}`]: {
        body: { valid: true, email: "maria@example.com" },
      },
      "GET /api/me": user("CUSTOMER", "someone@else.com"),
    });
    renderApp(`/invite/${TOKEN}`, createFakeAuth(fakeSession("someone@else.com")).client);
    expect(await screen.findByRole("heading", { name: "Wrong account" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept invitation" })).not.toBeInTheDocument();
  });

  it("accepts the invitation for the matching account", async () => {
    const api = mockApi({
      [`GET /api/invitations/lookup?token=${TOKEN}`]: {
        body: { valid: true, email: "maria@example.com" },
      },
      "GET /api/me": user("CUSTOMER"),
      "POST /api/invitations/accept": { body: { role: "SELLER" } },
    });
    const u = userEvent.setup();
    renderApp(`/invite/${TOKEN}`, createFakeAuth(fakeSession()).client);

    await u.click(await screen.findByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(api.find("POST", "/api/invitations/accept")).toHaveLength(1));
    const call = api.find("POST", "/api/invitations/accept")[0]!;
    expect(call.body).toEqual({ token: TOKEN });
    expect(call.authorization).toBe("Bearer test-access-token");
    expect(window.localStorage.getItem("kreatespace.pendingInvite")).toBeNull();
  });

  it("shows the server's reason when acceptance fails", async () => {
    mockApi({
      [`GET /api/invitations/lookup?token=${TOKEN}`]: {
        body: { valid: true, email: "maria@example.com" },
      },
      "GET /api/me": user("CUSTOMER"),
      "POST /api/invitations/accept": {
        status: 410,
        body: { error: { code: "INVITATION_EXPIRED", message: "This invitation has expired" } },
      },
    });
    const u = userEvent.setup();
    renderApp(`/invite/${TOKEN}`, createFakeAuth(fakeSession()).client);
    await u.click(await screen.findByRole("button", { name: "Accept invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This invitation has expired");
  });

  it("reminds customers of a pending invitation in the header", async () => {
    window.localStorage.setItem("kreatespace.pendingInvite", TOKEN);
    mockApi({ "GET /api/me": user("CUSTOMER") });
    renderApp("/", createFakeAuth(fakeSession()).client);
    const link = await screen.findByRole("link", { name: "Accept it" });
    expect(link).toHaveAttribute("href", `/invite/${TOKEN}`);
  });
});

describe("admin area access", () => {
  it("sends anonymous visitors to log in", async () => {
    mockApi();
    renderApp("/admin/invitations", createFakeAuth().client);
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it.each(["CUSTOMER", "SELLER"] as const)(
    "tells %s accounts they have no access",
    async (role) => {
      mockApi({ "GET /api/me": user(role) });
      renderApp("/admin/invitations", createFakeAuth(fakeSession()).client);
      expect(
        await screen.findByRole("heading", { name: "You don’t have access to this page" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
    },
  );
});

describe("admin invitations", () => {
  const pending = {
    id: "i1",
    email: "maria@example.com",
    status: "PENDING",
    expiresAt: "2026-11-01T00:00:00.000Z",
    createdAt: "2026-10-19T00:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
  };
  const accepted = { ...pending, id: "i2", email: "joy@example.com", status: "ACCEPTED" };

  it("lists invitations and offers revoke only for pending ones", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/invitations": { body: { invitations: [pending, accepted] } },
    });
    renderApp("/admin/invitations", createFakeAuth(fakeSession()).client);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("Pending")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Accepted")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Revoke invitation/ })).toHaveLength(1);
  });

  it("creates an invitation and shows the one-time link", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/invitations": { body: { invitations: [] } },
      "POST /api/admin/invitations": {
        status: 201,
        body: {
          invitation: { ...pending, email: "new@example.com" },
          inviteUrl: `https://kreatespace.test/invite/${TOKEN}`,
        },
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/invitations", createFakeAuth(fakeSession()).client);

    await u.type(await screen.findByLabelText("Email address"), "New@Example.com");
    await u.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(await screen.findByLabelText("Invitation link")).toHaveValue(
      `https://kreatespace.test/invite/${TOKEN}`,
    );
    expect(api.find("POST", "/api/admin/invitations")[0]!.body).toEqual({
      email: "new@example.com",
    });
  });

  it("validates the email before calling the API", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/invitations": { body: { invitations: [] } },
    });
    const u = userEvent.setup();
    renderApp("/admin/invitations", createFakeAuth(fakeSession()).client);
    await u.type(await screen.findByLabelText("Email address"), "nope");
    await u.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(api.find("POST", "/api/admin/invitations")).toHaveLength(0);
  });

  it("shows API conflicts such as an existing active invitation", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/invitations": { body: { invitations: [] } },
      "POST /api/admin/invitations": {
        status: 409,
        body: {
          error: { code: "INVITATION_EXISTS", message: "An active invitation already exists" },
        },
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/invitations", createFakeAuth(fakeSession()).client);
    await u.type(await screen.findByLabelText("Email address"), "maria@example.com");
    await u.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An active invitation already exists",
    );
  });

  it("revokes a pending invitation", async () => {
    const api = mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/invitations": { body: { invitations: [pending] } },
      "POST /api/admin/invitations/i1/revoke": {
        body: { invitation: { ...pending, status: "REVOKED" } },
      },
    });
    const u = userEvent.setup();
    renderApp("/admin/invitations", createFakeAuth(fakeSession()).client);
    await u.click(
      await screen.findByRole("button", { name: "Revoke invitation for maria@example.com" }),
    );
    await waitFor(() =>
      expect(api.find("POST", "/api/admin/invitations/i1/revoke")).toHaveLength(1),
    );
  });
});
