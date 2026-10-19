import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, user } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";

const client = () => createFakeAuth(fakeSession()).client;

const day = (date: string, extra: Record<string, number> = {}) => ({
  date,
  creationViews: 0,
  businessViews: 0,
  whatsappClicks: 0,
  websiteClicks: 0,
  ...extra,
});

const sellerBody = (overrides: Record<string, unknown> = {}) => ({
  days: 7,
  from: "2026-06-09",
  totals: { creationViews: 12, businessViews: 5, whatsappClicks: 4, websiteClicks: 2 },
  series: [
    day("2026-06-09"),
    day("2026-06-10", { creationViews: 7, businessViews: 2 }),
    day("2026-06-11", { creationViews: 5, businessViews: 3, whatsappClicks: 4, websiteClicks: 2 }),
  ],
  topCreations: [
    { creationId: "c1", title: "Floral Cake", views: 9, whatsappClicks: 3, websiteClicks: 1 },
    { creationId: "c2", title: "Plain Cake", views: 3, whatsappClicks: 1, websiteClicks: 1 },
  ],
  hasData: true,
  ...overrides,
});

describe("seller analytics page", () => {
  const seller = { "GET /api/me": user("SELLER") };

  it("shows real totals, charts with table views and the most popular creations", async () => {
    mockApi({ ...seller, "GET /api/analytics?days=30": { body: sellerBody({ days: 30 }) } });
    renderApp("/seller/analytics", client());

    const totals = await screen.findByLabelText("Totals for the last 30 days");
    expect(within(totals).getByText("17")).toBeInTheDocument(); // 12 + 5 views
    expect(within(totals).getByText("4")).toBeInTheDocument();
    expect(within(totals).getByText("2")).toBeInTheDocument();

    expect(
      screen.getByRole("img", { name: /Page views per day: 17 views over 3 days/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /WhatsApp link clicks per day: 4 clicks/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("View as a table")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "WhatsApp" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Floral Cake" })).toHaveAttribute(
      "href",
      "/seller/creations/c1",
    );
    // The click caveat is stated, not hidden.
    expect(screen.getByText(/tell us whether a message was sent/)).toBeInTheDocument();
  });

  it("changes the period and asks the API for it", async () => {
    const api = mockApi({
      ...seller,
      "GET /api/analytics?days=30": { body: sellerBody({ days: 30 }) },
      "GET /api/analytics?days=7": { body: sellerBody({ days: 7 }) },
    });
    renderApp("/seller/analytics", client());
    await screen.findByLabelText("Totals for the last 30 days");
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    await screen.findByLabelText("Totals for the last 7 days");
    expect(screen.getByRole("button", { name: "Last 7 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(api.find("GET", "/api/analytics?days=7")).toHaveLength(1);
  });

  it("explains an empty period instead of inventing numbers", async () => {
    mockApi({
      ...seller,
      "GET /api/analytics?days=30": {
        body: sellerBody({
          hasData: false,
          totals: { creationViews: 0, businessViews: 0, whatsappClicks: 0, websiteClicks: 0 },
          topCreations: [],
        }),
      },
    });
    renderApp("/seller/analytics", client());
    expect(
      await screen.findByText(/Nothing has been recorded in the last 30 days/),
    ).toBeInTheDocument();
    expect(screen.getByText(/No creation has been viewed or clicked/)).toBeInTheDocument();
  });

  it("offers a retry when the figures cannot be loaded", async () => {
    let attempts = 0;
    mockApi({
      ...seller,
      "GET /api/analytics?days=30": () =>
        ++attempts === 1
          ? { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "boom" } } }
          : { body: sellerBody({ days: 30 }) },
    });
    renderApp("/seller/analytics", client());
    expect(await screen.findByText(/couldn’t load your analytics/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByLabelText("Totals for the last 30 days");
  });

  it("is closed to customers", async () => {
    mockApi({ "GET /api/me": user("CUSTOMER") });
    renderApp("/seller/analytics", client());
    await waitFor(() => expect(screen.queryByText("Your analytics")).not.toBeInTheDocument());
  });
});

describe("admin analytics page", () => {
  it("shows what needs attention and platform totals", async () => {
    mockApi({
      "GET /api/me": user("ADMIN"),
      "GET /api/admin/analytics?days=30": {
        body: {
          days: 30,
          from: "2026-05-17",
          totals: { creationViews: 40, businessViews: 10, whatsappClicks: 6, websiteClicks: 3 },
          series: [day("2026-05-17"), day("2026-05-18", { creationViews: 40 })],
          businesses: { APPROVED: 12, PENDING: 3 },
          creations: { APPROVED: 80, PENDING: 5 },
          users: { CUSTOMER: 40, SELLER: 15, ADMIN: 1 },
          queues: {
            businessesPending: 3,
            creationsPending: 5,
            packagesPending: 0,
            websiteRequestsNew: 2,
          },
          topBusinesses: [
            {
              businessId: "b1",
              name: "Cakes by Maria",
              slug: "cakes-by-maria",
              views: 30,
              whatsappClicks: 4,
              websiteClicks: 1,
            },
          ],
        },
      },
    });
    renderApp("/admin/analytics", client());
    expect(await screen.findByRole("link", { name: /Business applications/ })).toHaveAttribute(
      "href",
      "/admin/businesses",
    );
    expect(screen.getByRole("link", { name: /New website requests/ })).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: /Packages to review/ })).toHaveTextContent("0");
    expect(screen.getByRole("link", { name: "Cakes by Maria" })).toHaveAttribute(
      "href",
      "/businesses/cakes-by-maria",
    );
    expect(screen.getByLabelText("Totals for the last 30 days")).toHaveTextContent("50");
  });

  it("is closed to sellers", async () => {
    mockApi({ "GET /api/me": user("SELLER") });
    renderApp("/admin/analytics", client());
    await waitFor(() => expect(screen.queryByText("Platform analytics")).not.toBeInTheDocument());
  });
});
