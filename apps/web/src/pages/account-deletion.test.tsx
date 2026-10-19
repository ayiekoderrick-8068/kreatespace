import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { DeletionState } from "../lib/account";
import { mockApi, user } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";

const IN_14_DAYS = new Date(Date.now() + 14 * 86_400_000).toISOString();
const NOW = new Date().toISOString();

const customerState = (overrides: Partial<DeletionState> = {}): DeletionState => ({
  request: null,
  effects: { role: "CUSTOMER", savedCreations: 3, business: null },
  graceDays: 14,
  ...overrides,
});

const openRequest = {
  id: "req-1",
  status: "REQUESTED" as const,
  requestedAt: NOW,
  scheduledFor: IN_14_DAYS,
  needsReview: false,
  reviewNote: null,
  completedAt: null,
};

async function openForm(u: ReturnType<typeof userEvent.setup>) {
  await u.click(await screen.findByRole("button", { name: "Delete my account…" }));
}

describe("deleting your account (customer)", () => {
  it("explains what deletion removes before asking for anything, and calls the API only on submit", async () => {
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": { body: customerState() },
    });
    const u = userEvent.setup();
    renderApp("/account", createFakeAuth(fakeSession()).client);

    await openForm(u);
    expect(screen.getByRole("form", { name: "Delete your account" })).toBeInTheDocument();
    expect(screen.getByText(/3 saved creations will be removed/)).toBeInTheDocument();
    expect(
      screen.getByText(/never your name, email or other personal details/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/We wait 14 days first, and you can cancel any time/),
    ).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("will not send the request until the person says they understand", async () => {
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": { body: customerState() },
    });
    const u = userEvent.setup();
    renderApp("/account", createFakeAuth(fakeSession()).client);
    await openForm(u);

    const send = screen.getByRole("button", { name: "Request account deletion" });
    expect(send).toBeDisabled();
    await u.click(screen.getByRole("checkbox", { name: /I understand/ }));
    expect(send).toBeEnabled();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows that a request was made, not that the account is gone", async () => {
    let state = customerState();
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": () => ({ body: state }),
      "POST /api/me/deletion": () => {
        state = customerState({ request: openRequest });
        return { status: 201, body: { request: openRequest } };
      },
    });
    const u = userEvent.setup();
    renderApp("/account", createFakeAuth(fakeSession()).client);
    await openForm(u);
    await u.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await u.click(screen.getByRole("button", { name: "Request account deletion" }));

    const status = await screen.findByText("Your account is scheduled for deletion");
    expect(status).toBeInTheDocument();
    expect(screen.getByText("Nothing has been deleted yet.")).toBeInTheDocument();
    expect(screen.getByText(/we wait 14 days so you can change your mind/)).toBeInTheDocument();
    expect(screen.queryByText(/your account (has been|was) deleted/i)).not.toBeInTheDocument();
    expect(api.find("POST", "/api/me/deletion")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Delete my account…" })).not.toBeInTheDocument();
  });

  it("signs in again with the password, then sends the request with the fresh sign-in", async () => {
    let state = customerState();
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": () => ({ body: state }),
      "POST /api/me/deletion": () => {
        state = customerState({ request: openRequest });
        return { status: 201, body: { request: openRequest } };
      },
    });
    const fake = createFakeAuth(fakeSession());
    fake.mocks.signInWithPassword.mockImplementation(async () => {
      const fresh = { ...fakeSession(), access_token: "fresh-token" };
      setTimeout(() => fake.emit("SIGNED_IN", fresh), 0);
      return { data: {}, error: null };
    });
    const u = userEvent.setup();
    renderApp("/account", fake.client);
    await openForm(u);
    await u.type(screen.getByLabelText(/Your password/), "correct horse");
    await u.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await u.click(screen.getByRole("button", { name: "Request account deletion" }));

    await screen.findByText("Your account is scheduled for deletion");
    expect(fake.mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "maria@example.com",
      password: "correct horse",
    });
    expect(api.find("POST", "/api/me/deletion")[0]!.authorization).toBe("Bearer fresh-token");
  });

  it("sends nothing when the password is wrong", async () => {
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": { body: customerState() },
    });
    const fake = createFakeAuth(fakeSession());
    fake.mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials", status: 400 },
    });
    const u = userEvent.setup();
    renderApp("/account", fake.client);
    await openForm(u);
    await u.type(screen.getByLabelText(/Your password/), "wrong");
    await u.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await u.click(screen.getByRole("button", { name: "Request account deletion" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    expect(screen.getByRole("button", { name: "Request account deletion" })).toBeEnabled();
  });

  it("asks for the password again when the server says the sign-in is too old", async () => {
    mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": { body: customerState() },
      "POST /api/me/deletion": {
        status: 403,
        body: { error: { code: "REAUTHENTICATION_REQUIRED", message: "Please confirm again" } },
      },
    });
    const u = userEvent.setup();
    renderApp("/account", createFakeAuth(fakeSession()).client);
    await openForm(u);
    await u.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await u.click(screen.getByRole("button", { name: "Request account deletion" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/confirm your password again/);
    expect(screen.getByLabelText(/Your password/)).toBeInTheDocument();
  });

  it("explains a network failure without losing the form", async () => {
    mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": { body: customerState() },
      "POST /api/me/deletion": { status: 500, body: { error: { code: "X", message: "Boom" } } },
    });
    const u = userEvent.setup();
    renderApp("/account", createFakeAuth(fakeSession()).client);
    await openForm(u);
    await u.click(screen.getByRole("checkbox", { name: /I understand/ }));
    await u.click(screen.getByRole("button", { name: "Request account deletion" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Boom");
    expect(screen.getByRole("checkbox", { name: /I understand/ })).toBeChecked();
  });

  it("lets a pending request be cancelled, and says so", async () => {
    let state = customerState({ request: openRequest });
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": () => ({ body: state }),
      "DELETE /api/me/deletion": () => {
        state = customerState({ request: { ...openRequest, status: "CANCELLED" } });
        return { body: { request: { ...openRequest, status: "CANCELLED" } } };
      },
    });
    const u = userEvent.setup();
    renderApp("/account", createFakeAuth(fakeSession()).client);

    await u.click(await screen.findByRole("button", { name: /Keep my account/ }));
    expect(await screen.findByText(/Your request was cancelled/)).toBeInTheDocument();
    expect(api.find("DELETE", "/api/me/deletion")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Delete my account…" })).toBeInTheDocument();
  });

  it("shows why a request was refused and allows asking again", async () => {
    mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": {
        body: customerState({
          request: {
            ...openRequest,
            status: "REJECTED",
            reviewNote: "Please settle your invoice.",
          },
        }),
      },
    });
    renderApp("/account", createFakeAuth(fakeSession()).client);
    expect(
      await screen.findByText(/wasn’t approved: Please settle your invoice\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete my account…" })).toBeInTheDocument();
  });

  it("says so when the options cannot be loaded", async () => {
    mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": { status: 500, body: { error: { code: "X", message: "Boom" } } },
    });
    renderApp("/account", createFakeAuth(fakeSession()).client);
    expect(await screen.findByText(/Couldn’t load your deletion options/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete my account…" })).not.toBeInTheDocument();
  });

  it("does not offer deletion to administrators", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/me/deletion": {
        body: customerState({ effects: { role: "ADMIN", savedCreations: 0, business: null } }),
      },
    });
    renderApp("/account", createFakeAuth(fakeSession()).client);
    expect(
      await screen.findByText(/Administrator accounts are removed by the owner/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete my account…" })).not.toBeInTheDocument();
  });

  it("is not shown, and asks nothing of the API, to a visitor who is logged out", async () => {
    const api = mockApi();
    renderApp("/account", createFakeAuth().client);
    await waitFor(() => expect(screen.queryByText("Your account")).not.toBeInTheDocument());
    expect(api.calls.some((c) => c.path.includes("/api/me/deletion"))).toBe(false);
  });

  it("works from the keyboard alone, with focus moving to the form", async () => {
    let posted = false;
    mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/deletion": () => ({
        body: customerState(posted ? { request: openRequest } : {}),
      }),
      "POST /api/me/deletion": () => {
        posted = true;
        return { status: 201, body: { request: openRequest } };
      },
    });
    const u = userEvent.setup();
    renderApp("/account", createFakeAuth(fakeSession()).client);

    const open = await screen.findByRole("button", { name: "Delete my account…" });
    open.focus();
    await u.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Delete your account", level: 3 })).toHaveFocus();
    await u.tab(); // password
    expect(screen.getByLabelText(/Your password/)).toHaveFocus();
    await u.tab(); // checkbox
    await u.keyboard(" ");
    expect(screen.getByRole("checkbox", { name: /I understand/ })).toBeChecked();
    await u.tab(); // submit
    expect(screen.getByRole("button", { name: "Request account deletion" })).toHaveFocus();
    await u.keyboard("{Enter}");
    expect(await screen.findByText("Your account is scheduled for deletion")).toBeInTheDocument();
  });
});
