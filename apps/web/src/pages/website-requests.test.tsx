import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, user } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";

const client = () => createFakeAuth(fakeSession()).client;

const request = (overrides: Record<string, unknown> = {}) => ({
  id: "r1",
  type: "NEW_WEBSITE",
  description: "We bake wedding cakes and want a simple website.",
  budget: "50K_150K",
  timeline: null,
  status: "NEW",
  responseNote: null,
  cancellable: true,
  createdAt: "2026-10-19T08:00:00.000Z",
  ...overrides,
});

describe("seller website requests", () => {
  const seller = { "GET /api/me": user("SELLER") };

  it("validates and sends a request", async () => {
    const api = mockApi({
      ...seller,
      "GET /api/website-requests": { body: { requests: [], canRequest: true } },
      "POST /api/website-requests": { status: 201, body: request() },
    });
    renderApp("/seller/website", client());
    const form = await screen.findByRole("form", { name: "Website request" });

    // Nothing is sent until the form is valid, and each problem is explained.
    await userEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(await within(form).findByText("Choose what you need")).toBeInTheDocument();
    expect(within(form).getByText(/at least 20 characters/)).toBeInTheDocument();
    expect(api.find("POST", "/api/website-requests")).toHaveLength(0);

    await userEvent.selectOptions(within(form).getByLabelText(/What do you need/), "NEW_WEBSITE");
    await userEvent.type(
      within(form).getByLabelText(/Tell us about your business/),
      "We bake wedding cakes and want a simple website.",
    );
    await userEvent.selectOptions(within(form).getByLabelText(/Budget/), "50K_150K");
    await userEvent.click(within(form).getByRole("button", { name: "Send request" }));

    expect(await screen.findByText(/Your request was sent/)).toBeInTheDocument();
    expect(api.find("POST", "/api/website-requests")[0]!.body).toEqual({
      type: "NEW_WEBSITE",
      description: "We bake wedding cakes and want a simple website.",
      budget: "50K_150K",
      timeline: null,
    });
  });

  it("shows progress and the team's reply, and hides the form while a request is open", async () => {
    mockApi({
      ...seller,
      "GET /api/website-requests": {
        body: {
          canRequest: false,
          requests: [request({ status: "QUOTED", responseNote: "We can do this for KSh 90,000." })],
        },
      },
    });
    renderApp("/seller/website", client());
    const list = await screen.findByRole("list", { name: "Your requests" });
    expect(within(list).getByText("Quote sent")).toBeInTheDocument();
    expect(within(list).getByText("We can do this for KSh 90,000.")).toBeInTheDocument();
    expect(within(list).getByText(/Budget: KSh 50,000/)).toBeInTheDocument();
    expect(screen.getByText(/You have an open request/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Website request" })).not.toBeInTheDocument();
  });

  it("asks before withdrawing, then withdraws", async () => {
    const api = mockApi({
      ...seller,
      "GET /api/website-requests": { body: { canRequest: false, requests: [request()] } },
      "POST /api/website-requests/r1/cancel": {
        body: request({ status: "CANCELLED", cancellable: false }),
      },
    });
    renderApp("/seller/website", client());
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw request" }));
    expect(api.find("POST", "/api/website-requests/r1/cancel")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Yes, withdraw it" }));
    expect(await screen.findByText("Your request was withdrawn.")).toBeInTheDocument();
    expect(api.find("POST", "/api/website-requests/r1/cancel")).toHaveLength(1);
  });

  it("shows the server's reason when a request is refused", async () => {
    mockApi({
      ...seller,
      "GET /api/website-requests": { body: { requests: [], canRequest: true } },
      "POST /api/website-requests": {
        status: 409,
        body: {
          error: {
            code: "WEBSITE_REQUEST_OPEN",
            message: "You already have an open website request.",
          },
        },
      },
    });
    renderApp("/seller/website", client());
    const form = await screen.findByRole("form", { name: "Website request" });
    await userEvent.selectOptions(within(form).getByLabelText(/What do you need/), "OTHER");
    await userEvent.type(
      within(form).getByLabelText(/Tell us about your business/),
      "Something rather different from the usual.",
    );
    await userEvent.click(within(form).getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already have an open website request.",
    );
  });
});

describe("admin website requests", () => {
  const admin = { "GET /api/me": user("ADMIN") };
  const adminRequest = (overrides: Record<string, unknown> = {}) => ({
    ...request(),
    adminNotes: "Call on Monday",
    business: {
      id: "b1",
      slug: "cakes-by-maria",
      name: "Cakes by Maria",
      ownerName: "Maria Wanjiku",
      whatsappNumber: "+254712345678",
      websiteUrl: null,
      ownerEmail: "maria@example.com",
    },
    ...overrides,
  });

  it("lists requests with contact details and only the allowed next statuses", async () => {
    mockApi({
      ...admin,
      "GET /api/admin/website-requests?status=NEW&page=1": {
        body: { requests: [adminRequest()], total: 1, page: 1, pageSize: 20 },
      },
    });
    renderApp("/admin/website-requests", client());
    const list = await screen.findByRole("list", { name: "Website requests" });
    expect(within(list).getByText("Cakes by Maria")).toBeInTheDocument();
    expect(within(list).getByText(/maria@example.com/)).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      expect.stringContaining("wa.me/254712345678"),
    );
    const status = within(list).getByLabelText("Status");
    const options = within(status)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["New (current)", "In review", "Quote sent", "Declined"]);
  });

  it("saves a status change with a reply and private notes", async () => {
    const api = mockApi({
      ...admin,
      "GET /api/admin/website-requests?status=NEW&page=1": {
        body: { requests: [adminRequest()], total: 1, page: 1, pageSize: 20 },
      },
      "PATCH /api/admin/website-requests/r1": { body: adminRequest({ status: "QUOTED" }) },
    });
    renderApp("/admin/website-requests", client());
    const list = await screen.findByRole("list", { name: "Website requests" });
    await userEvent.selectOptions(within(list).getByLabelText("Status"), "QUOTED");
    await userEvent.type(
      within(list).getByLabelText(/Reply to the seller/),
      "We can do it for KSh 90,000.",
    );
    await userEvent.click(within(list).getByRole("button", { name: "Save" }));

    expect(await within(list).findByText("Saved.")).toBeInTheDocument();
    expect(api.find("PATCH", "/api/admin/website-requests/r1")[0]!.body).toEqual({
      status: "QUOTED",
      responseNote: "We can do it for KSh 90,000.",
      adminNotes: "Call on Monday",
    });
  });

  it("explains an empty queue and a closed request", async () => {
    mockApi({
      ...admin,
      "GET /api/admin/website-requests?status=NEW&page=1": {
        body: { requests: [], total: 0, page: 1, pageSize: 20 },
      },
    });
    const { unmount } = renderApp("/admin/website-requests", client());
    expect(await screen.findByText("No requests match this filter.")).toBeInTheDocument();
    unmount();

    mockApi({
      ...admin,
      "GET /api/admin/website-requests?status=NEW&page=1": {
        body: {
          requests: [adminRequest({ status: "COMPLETED" })],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
    });
    renderApp("/admin/website-requests", client());
    expect(await screen.findByText("This request is closed.")).toBeInTheDocument();
  });

  it("is closed to sellers", async () => {
    mockApi({ "GET /api/me": user("SELLER") });
    renderApp("/admin/website-requests", client());
    await waitFor(() => expect(screen.queryByText("Website requests")).not.toBeInTheDocument());
  });
});
