import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";

const admin = (mfa?: { required: boolean; satisfied: boolean }) => ({
  status: 200,
  body: {
    user: {
      id: "u1",
      email: "admin@example.com",
      fullName: "Admin",
      role: "ADMIN",
      ...(mfa ? { mfa } : {}),
    },
  },
});

/** What Supabase does after a correct code: it hands the browser a new, stronger session. */
function deliverStrongerSession(fake: ReturnType<typeof createFakeAuth>) {
  fake.mocks.mfa.challengeAndVerify.mockImplementation(async () => {
    fake.emit("MFA_CHALLENGE_VERIFIED", { ...fakeSession(), access_token: "stronger-token" });
    return { data: {}, error: null };
  });
}

const analytics = {
  body: {
    days: 30,
    from: "2026-06-01",
    totals: { creationViews: 0, businessViews: 0, whatsappClicks: 0, websiteClicks: 0 },
    series: [],
    businesses: {},
    creations: {},
    users: {},
    topBusinesses: [],
    queues: {
      businessesPending: 0,
      creationsPending: 0,
      packagesPending: 0,
      websiteRequestsNew: 0,
    },
  },
};

describe("administrator two-step verification screen", () => {
  it("opens the admin area straight away once the second step is done", async () => {
    const fake = createFakeAuth(fakeSession());
    mockApi({
      "GET /api/me": admin({ required: true, satisfied: true }),
      "GET /api/admin/analytics?days=30": analytics,
    });
    renderApp("/admin/analytics", fake.client);
    expect(await screen.findByRole("heading", { name: "Platform analytics" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Two-step verification" }),
    ).not.toBeInTheDocument();
    expect(fake.mocks.mfa.enroll).not.toHaveBeenCalled();
  });

  it("does not interfere when the step is not required (local development)", async () => {
    const fake = createFakeAuth(fakeSession());
    mockApi({
      "GET /api/me": admin({ required: false, satisfied: false }),
      "GET /api/admin/analytics?days=30": analytics,
    });
    renderApp("/admin/analytics", fake.client);
    expect(await screen.findByRole("heading", { name: "Platform analytics" })).toBeInTheDocument();
  });

  it("asks for a code when an authenticator is already set up, hiding the admin pages until it is right", async () => {
    const fake = createFakeAuth(fakeSession());
    let satisfied = false;
    const api = mockApi({
      "GET /api/me": () => admin({ required: true, satisfied }),
      "GET /api/admin/analytics?days=30": analytics,
    });
    renderApp("/admin/analytics", fake.client);

    expect(
      await screen.findByRole("heading", { name: "Two-step verification" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Platform analytics" })).not.toBeInTheDocument();
    expect(api.find("GET", "/api/admin/analytics?days=30")).toHaveLength(0);

    const form = await screen.findByRole("form", { name: "Verification code" });
    const user = userEvent.setup();
    // Not six digits: refused without bothering the provider.
    await user.type(screen.getByLabelText("6-digit code"), "12ab");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Enter the 6-digit code/)).toBeInTheDocument();
    expect(fake.mocks.mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(form).toBeInTheDocument();

    // A wrong code is explained and the pages stay hidden.
    fake.mocks.mfa.challengeAndVerify.mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid TOTP code entered" },
    });
    await user.clear(screen.getByLabelText("6-digit code"));
    await user.type(screen.getByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/That code didn’t work/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid TOTP/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Platform analytics" })).not.toBeInTheDocument();

    // The right code lets the admin area through once the server agrees.
    satisfied = true;
    deliverStrongerSession(fake);
    await user.type(screen.getByLabelText("6-digit code"), "123 456");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Platform analytics" })).toBeInTheDocument();
    expect(fake.mocks.mfa.challengeAndVerify).toHaveBeenLastCalledWith({
      factorId: "factor-1",
      code: "123456",
    });
  });

  it("walks a first-time administrator through setting up an authenticator, discarding abandoned attempts", async () => {
    const fake = createFakeAuth(fakeSession());
    fake.mocks.mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: "old-attempt", factor_type: "totp", status: "unverified" }], totp: [] },
      error: null,
    });
    let satisfied = false;
    mockApi({
      "GET /api/me": () => admin({ required: true, satisfied }),
      "GET /api/admin/analytics?days=30": analytics,
    });
    renderApp("/admin/analytics", fake.client);

    expect(await screen.findByAltText(/QR code to add KreateSpace/)).toBeInTheDocument();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(fake.mocks.mfa.unenroll).toHaveBeenCalledWith({ factorId: "old-attempt" });
    expect(fake.mocks.mfa.enroll).toHaveBeenCalledWith({
      factorType: "totp",
      friendlyName: "Authenticator app",
    });
    expect(screen.queryByRole("heading", { name: "Platform analytics" })).not.toBeInTheDocument();

    satisfied = true;
    deliverStrongerSession(fake);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("6-digit code"), "654321");
    await user.click(screen.getByRole("button", { name: "Finish set-up" }));
    expect(await screen.findByRole("heading", { name: "Platform analytics" })).toBeInTheDocument();
    expect(fake.mocks.mfa.challengeAndVerify).toHaveBeenCalledWith({
      factorId: "factor-new",
      code: "654321",
    });
  });

  it("explains a provider failure without technical detail and offers to try again", async () => {
    const fake = createFakeAuth(fakeSession());
    fake.mocks.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: null,
      error: { message: "ECONNREFUSED 10.0.0.1" },
    });
    mockApi({ "GET /api/me": admin({ required: true, satisfied: false }) });
    renderApp("/admin/analytics", fake.client);
    expect(await screen.findByText(/isn’t available right now/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/);
  });

  it("lets the administrator log out from the screen", async () => {
    const fake = createFakeAuth(fakeSession());
    mockApi({ "GET /api/me": admin({ required: true, satisfied: false }) });
    renderApp("/admin/businesses", fake.client);
    await screen.findByRole("heading", { name: "Two-step verification" });
    const gate = screen.getByRole("region", { name: "Two-step verification" });
    await userEvent.click(within(gate).getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(fake.mocks.signOut).toHaveBeenCalled());
  });

  it("points an administrator who lost their phone to the owner, not to a self-service bypass", async () => {
    const fake = createFakeAuth(fakeSession());
    mockApi({ "GET /api/me": admin({ required: true, satisfied: false }) });
    renderApp("/admin/businesses", fake.client);
    expect(await screen.findByText(/ask the owner to reset/)).toBeInTheDocument();
  });
});
