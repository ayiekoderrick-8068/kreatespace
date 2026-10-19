import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../test/mockApi";
import { createFakeAuth, renderApp } from "../test/renderWithProviders";

const ID = "00000000-0000-4000-8000-000000000042";

function creation(
  overrides: Record<string, unknown> = {},
  businessOverrides: Record<string, unknown> = {},
) {
  return {
    id: ID,
    title: "Garden Wedding Photography",
    description: "Candid wedding photography across Nairobi.",
    category: { slug: "photography", name: "Photography" },
    occasion: null,
    images: [{ url: "/dev-fixtures/a.svg", srcSet: null, width: 800, height: 1000 }],
    publishedAt: null,
    business: {
      slug: "lens-works",
      name: "Lens Works",
      county: "Mombasa",
      city: "Nyali",
      logoUrl: null,
      websiteUrl: "https://lensworks.example",
      whatsappNumber: "+254712345678",
      ...businessOverrides,
    },
    ...overrides,
  };
}

function setupCreation(body: unknown = creation()) {
  return mockApi({
    [`GET /api/public/creations/${ID}`]: { body: { creation: body } },
    [`GET /api/public/creations/${ID}/related`]: {
      body: { items: [], page: 1, pageSize: 8, hasMore: false },
    },
    "POST /api/public/events": { status: 202, body: { recorded: true } },
  });
}

const events = (api: ReturnType<typeof mockApi>) =>
  api.calls
    .filter((c) => c.method === "POST" && c.path === "/api/public/events")
    .map((c) => c.body);

let open: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.sessionStorage.clear();
  open = vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => open.mockRestore());

describe("analytics on the creation page", () => {
  it("counts the view once per session, however often it renders", async () => {
    const api = setupCreation();
    const first = renderApp(`/creations/${ID}`, createFakeAuth().client);
    await screen.findByRole("heading", { level: 1, name: "Garden Wedding Photography" });
    await waitFor(() => expect(events(api)).toHaveLength(1));
    expect(events(api)[0]).toEqual({ type: "CREATION_VIEW", creationId: ID });
    first.unmount();

    const again = setupCreation();
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    await screen.findByRole("heading", { level: 1, name: "Garden Wedding Photography" });
    await screen.findByRole("region", { name: "About the business" });
    expect(events(again)).toHaveLength(0);
  });

  it("records WhatsApp and website clicks with their source, and nothing personal", async () => {
    const api = setupCreation();
    const u = userEvent.setup();
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    const about = await screen.findByRole("region", { name: "About the business" });

    await u.click(within(about).getByRole("link", { name: "Enquire on WhatsApp" }));
    await u.click(within(about).getByRole("link", { name: "Visit website" }));
    await waitFor(() => expect(events(api)).toHaveLength(3));
    expect(events(api).slice(1)).toEqual([
      {
        type: "WHATSAPP_CLICK",
        businessSlug: "lens-works",
        creationId: ID,
        source: "creation_page",
      },
      {
        type: "WEBSITE_CLICK",
        businessSlug: "lens-works",
        creationId: ID,
        source: "creation_page",
      },
    ]);
    const sent = JSON.stringify(events(api));
    expect(sent).not.toMatch(/254712345678|Hello|interested|message/i);
  });

  it("still opens WhatsApp if analytics fail", async () => {
    mockApi({
      [`GET /api/public/creations/${ID}`]: { body: { creation: creation() } },
      [`GET /api/public/creations/${ID}/related`]: {
        body: { items: [], page: 1, pageSize: 8, hasMore: false },
      },
      "POST /api/public/events": {
        status: 500,
        body: { error: { code: "INTERNAL_ERROR", message: "x" } },
      },
    });
    const u = userEvent.setup();
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    const link = await screen.findByRole("link", { name: "Enquire on WhatsApp" });
    await u.click(link);
    expect(link).toHaveAttribute(
      "href",
      expect.stringMatching(/^https:\/\/wa\.me\/254712345678\?text=/),
    );
  });

  it("uses the prepared message and the seller's own number, with the creation link", async () => {
    setupCreation();
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    const link = await screen.findByRole("link", { name: "Enquire on WhatsApp" });
    const href = new URL(link.getAttribute("href")!);
    expect(href.pathname).toBe("/254712345678");
    const text = href.searchParams.get("text")!;
    expect(text).toContain(
      "Hello Lens Works! I found your Garden Wedding Photography on KreateSpace.",
    );
    expect(text).toContain("Could you please share the price, availability, and ordering details?");
    expect(text).toContain(`/creations/${ID}`);
  });

  it("supports a seller's international number", async () => {
    setupCreation(creation({}, { whatsappNumber: "+447700900123" }));
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    const link = await screen.findByRole("link", { name: "Enquire on WhatsApp" });
    expect(new URL(link.getAttribute("href")!).pathname).toBe("/447700900123");
  });
});

describe("optional quote requests", () => {
  async function openForm(u: ReturnType<typeof userEvent.setup>) {
    await u.click(await screen.findByRole("button", { name: "Request a quote" }));
    return screen.getByRole("form", { name: "Quote request" });
  }

  it("is offered for photography and event decoration, not for cakes or fashion", async () => {
    setupCreation(creation({ category: { slug: "event-decor", name: "Event Decor" } }));
    const { unmount } = renderApp(`/creations/${ID}`, createFakeAuth().client);
    expect(await screen.findByRole("button", { name: "Request a quote" })).toBeInTheDocument();
    unmount();

    for (const slug of ["cakes", "fashion"]) {
      setupCreation(creation({ category: { slug, name: slug } }));
      const view = renderApp(`/creations/${ID}`, createFakeAuth().client);
      await screen.findByRole("region", { name: "About the business" });
      expect(screen.queryByRole("button", { name: "Request a quote" })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("validates before preparing anything", async () => {
    setupCreation();
    const u = userEvent.setup();
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    await openForm(u);
    await u.clear(screen.getByLabelText(/^Service needed/));
    await u.click(screen.getByRole("button", { name: "Continue in WhatsApp" }));
    expect(await screen.findByText("Say what service you need")).toBeInTheDocument();
    expect(screen.getByText(/Tell the business where the event is/)).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects a date in the past", async () => {
    setupCreation();
    const u = userEvent.setup();
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    await openForm(u);
    await u.type(screen.getByLabelText(/^Event date/), "2001-01-01");
    await u.click(screen.getByRole("button", { name: "Continue in WhatsApp" }));
    expect(await screen.findByText("The event date can’t be in the past")).toBeInTheDocument();
  });

  it("prepares a WhatsApp message for the seller to send, and sends nothing to KreateSpace", async () => {
    const api = setupCreation();
    const u = userEvent.setup();
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    await openForm(u);
    expect(screen.getByLabelText(/^Service needed/)).toHaveValue("Photography");
    await u.clear(screen.getByLabelText(/^Service needed/));
    await u.type(screen.getByLabelText(/^Service needed/), "Wedding photography");
    await u.type(screen.getByLabelText(/^Event date/), "2099-12-12");
    await u.type(screen.getByLabelText(/^Event location/), "Karen, Nairobi");
    await u.type(
      screen.getByLabelText(/^A few details/),
      "Full-day coverage for about 150 guests.",
    );
    await u.type(screen.getByLabelText(/^Your name/), "Joy");
    await u.click(screen.getByRole("button", { name: "Continue in WhatsApp" }));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const [url, target, features] = open.mock.calls[0]!;
    expect(target).toBe("_blank");
    expect(features).toContain("noopener");
    const link = new URL(String(url));
    expect(link.origin + link.pathname).toBe("https://wa.me/254712345678");
    const text = link.searchParams.get("text")!;
    expect(text).toContain(
      "Hello Lens Works! I found you on KreateSpace and I'd like a quote for Wedding photography.",
    );
    expect(text).toContain("I was looking at: Garden Wedding Photography");
    expect(text).toContain("Event date: 12 December 2099");
    expect(text).toContain("Location: Karen, Nairobi");
    expect(text).toContain("Details: Full-day coverage for about 150 guests.");
    expect(text).toContain("Thank you, Joy");

    expect(screen.getByText(/WhatsApp should open with your message ready/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /WhatsApp didn’t open/ })).toHaveAttribute(
      "href",
      String(url),
    );

    // Only an anonymous click event is recorded; none of the details leave the browser.
    const quoteEvent = events(api).find((e) => (e as { source?: string }).source === "quote");
    expect(quoteEvent).toEqual({
      type: "WHATSAPP_CLICK",
      businessSlug: "lens-works",
      creationId: ID,
      source: "quote",
    });
    expect(JSON.stringify(api.calls)).not.toMatch(/Karen|150 guests|Joy/);
    expect(screen.getByText(/KreateSpace doesn’t keep these details/)).toBeInTheDocument();
  });

  it("can be closed again", async () => {
    setupCreation();
    const u = userEvent.setup();
    renderApp(`/creations/${ID}`, createFakeAuth().client);
    await openForm(u);
    await u.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("form", { name: "Quote request" })).not.toBeInTheDocument();
  });
});

describe("business profile inquiries and packages", () => {
  const business = (overrides: Record<string, unknown> = {}) => ({
    slug: "lens-works",
    businessName: "Lens Works",
    description: "Wedding and event photographers in Mombasa.",
    category: { slug: "photography", name: "Photography" },
    categories: [{ slug: "photography", name: "Photography" }],
    county: "Mombasa",
    city: "Nyali",
    websiteUrl: "https://lensworks.example",
    whatsappNumber: "+254712345678",
    logoUrl: null,
    images: [],
    creations: [],
    hasMoreCreations: false,
    packages: [],
    ...overrides,
  });

  function setup(body: unknown) {
    return mockApi({
      "GET /api/public/businesses/lens-works": { body: { business: body } },
      "POST /api/public/events": { status: 202, body: { recorded: true } },
    });
  }

  it("shows approved packages with an optional price, what's included and a direct enquiry link", async () => {
    const api = setup(
      business({
        packages: [
          {
            id: "pk1",
            name: "Wedding Photography Package",
            description: "Full-day coverage of your wedding.",
            includes: ["Event coverage", "Edited photographs", "Digital gallery"],
            startingPriceKes: 80000,
            image: null,
          },
          {
            id: "pk2",
            name: "Portrait Session",
            description: "A relaxed one-hour portrait session.",
            includes: ["Edited photographs"],
            startingPriceKes: null,
            image: null,
          },
        ],
      }),
    );
    const u = userEvent.setup();
    renderApp("/businesses/lens-works", createFakeAuth().client);
    const section = (await screen.findByRole("heading", { name: "Service packages" })).closest(
      "section",
    )!;
    expect(within(section).getByText("From KSh 80,000")).toBeInTheDocument();
    expect(within(section).getAllByText(/From KSh/)).toHaveLength(1); // no invented price for the other
    expect(within(section).getByText("Digital gallery")).toBeInTheDocument();

    const links = within(section).getAllByRole("link", { name: "Ask about this package" });
    const first = new URL(links[0]!.getAttribute("href")!);
    expect(first.pathname).toBe("/254712345678");
    expect(first.searchParams.get("text")).toContain(
      "I found your Wedding Photography Package on KreateSpace",
    );

    await u.click(links[0]!);
    await waitFor(() =>
      expect(events(api)).toContainEqual({
        type: "WHATSAPP_CLICK",
        businessSlug: "lens-works",
        packageId: "pk1",
        source: "package",
      }),
    );
  });

  it("counts the profile view and its link clicks", async () => {
    const api = setup(business());
    const u = userEvent.setup();
    renderApp("/businesses/lens-works", createFakeAuth().client);
    await u.click(await screen.findByRole("link", { name: "Message on WhatsApp" }));
    await u.click(screen.getByRole("link", { name: "Visit website" }));
    await waitFor(() => expect(events(api)).toHaveLength(3));
    expect(events(api)).toEqual([
      { type: "BUSINESS_VIEW", businessSlug: "lens-works" },
      { type: "WHATSAPP_CLICK", businessSlug: "lens-works", source: "business_page" },
      { type: "WEBSITE_CLICK", businessSlug: "lens-works", source: "business_page" },
    ]);
  });

  it("offers a quote request to photography and decoration businesses only", async () => {
    setup(business());
    const { unmount } = renderApp("/businesses/lens-works", createFakeAuth().client);
    expect(await screen.findByRole("button", { name: "Request a quote" })).toBeInTheDocument();
    unmount();

    setup(
      business({
        category: { slug: "cakes", name: "Cakes" },
        categories: [{ slug: "cakes", name: "Cakes" }],
      }),
    );
    renderApp("/businesses/lens-works", createFakeAuth().client);
    await screen.findByRole("heading", { name: "Lens Works", level: 1 });
    expect(screen.queryByRole("button", { name: "Request a quote" })).not.toBeInTheDocument();
  });

  it("hides contact actions for a number it can't trust, and shows no packages section when there are none", async () => {
    setup(business({ whatsappNumber: "12345" }));
    renderApp("/businesses/lens-works", createFakeAuth().client);
    await screen.findByRole("heading", { name: "Lens Works", level: 1 });
    expect(screen.queryByRole("link", { name: "Message on WhatsApp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request a quote" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Service packages" })).not.toBeInTheDocument();
  });
});
