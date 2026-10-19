import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { card } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp } from "../test/renderWithProviders";

const ID = "00000000-0000-4000-8000-000000000042";

function creation(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    title: "Floral Birthday Cake",
    description: "Three-tier vanilla sponge with sugar flowers.",
    category: { slug: "cakes", name: "Cakes" },
    occasion: { slug: "birthday", name: "Birthday" },
    images: [
      { url: "/dev-fixtures/a.svg", srcSet: null, width: 800, height: 1000 },
      { url: "/dev-fixtures/b.svg", srcSet: null, width: 1000, height: 800 },
    ],
    publishedAt: "2026-10-01T08:00:00.000Z",
    business: {
      slug: "cakes-by-maria",
      name: "Cakes by Maria",
      county: "Nairobi",
      city: "Westlands",
      logoUrl: null,
      websiteUrl: "https://cakes-by-maria.vercel.app",
      whatsappNumber: "+254712345678",
    },
    ...overrides,
  };
}

function setup(creationBody: unknown = creation(), related: unknown[] = [card(1), card(2)]) {
  return mockApi({
    [`GET /api/public/creations/${ID}`]: { body: { creation: creationBody } },
    [`GET /api/public/creations/${ID}/related`]: {
      body: { items: related, page: 1, pageSize: 8, hasMore: false },
    },
  });
}

describe("creation detail page", () => {
  it("shows the creation, its category and occasion, and the business behind it", async () => {
    setup();
    renderApp(`/creations/${ID}`);
    expect(
      await screen.findByRole("heading", { name: "Floral Birthday Cake", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Three-tier vanilla sponge with sugar flowers.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cakes" })).toHaveAttribute(
      "href",
      "/explore?category=cakes",
    );
    expect(screen.getByRole("link", { name: "Birthday" })).toHaveAttribute(
      "href",
      "/explore?occasion=birthday",
    );
    expect(document.title).toBe("Floral Birthday Cake — KreateSpace");

    const about = screen.getByRole("region", { name: "About the business" });
    expect(within(about).getByRole("link", { name: "Cakes by Maria" })).toHaveAttribute(
      "href",
      "/businesses/cakes-by-maria",
    );
    expect(within(about).getByText("Westlands, Nairobi")).toBeInTheDocument();
    expect(within(about).getByRole("link", { name: "View all their work" })).toHaveAttribute(
      "href",
      "/businesses/cakes-by-maria",
    );
  });

  it("links to the seller's WhatsApp with a prepared message that names the creation", async () => {
    setup();
    renderApp(`/creations/${ID}`);
    const link = await screen.findByRole("link", { name: "Enquire on WhatsApp" });
    const href = new URL(link.getAttribute("href")!);
    expect(href.origin + href.pathname).toBe("https://wa.me/254712345678");
    const text = href.searchParams.get("text")!;
    expect(text).toContain(
      "Hello Cakes by Maria! I found your Floral Birthday Cake on KreateSpace.",
    );
    expect(text).toContain(`/creations/${ID}`);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("offers the seller's website only when they have one", async () => {
    setup();
    const { unmount } = renderApp(`/creations/${ID}`);
    const visit = await screen.findByRole("link", { name: "Visit website" });
    expect(visit).toHaveAttribute("href", "https://cakes-by-maria.vercel.app");
    unmount();

    setup(creation({ business: { ...creation().business, websiteUrl: null } }));
    renderApp(`/creations/${ID}`);
    await screen.findByRole("heading", { name: "Floral Birthday Cake", level: 1 });
    expect(screen.queryByRole("link", { name: "Visit website" })).not.toBeInTheDocument();
  });

  it("hides contact actions it cannot trust", async () => {
    setup(
      creation({
        business: {
          ...creation().business,
          websiteUrl: "javascript:alert(1)",
          whatsappNumber: "12345",
        },
      }),
    );
    renderApp(`/creations/${ID}`);
    await screen.findByRole("heading", { name: "Floral Birthday Cake", level: 1 });
    expect(screen.queryByRole("link", { name: "Visit website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enquire on WhatsApp" })).not.toBeInTheDocument();
  });

  it("lets people flip through the photos", async () => {
    setup();
    const u = userEvent.setup();
    renderApp(`/creations/${ID}`);
    const main = await screen.findByAltText("Floral Birthday Cake by Cakes by Maria");
    expect(main).toHaveAttribute("src", "/dev-fixtures/a.svg");
    await u.click(screen.getByRole("button", { name: "Show photo 2 of 2" }));
    expect(screen.getByAltText("Floral Birthday Cake by Cakes by Maria")).toHaveAttribute(
      "src",
      "/dev-fixtures/b.svg",
    );
    expect(screen.getByRole("button", { name: "Show photo 2 of 2" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("does not show thumbnails for a single photo, and never invents price or availability", async () => {
    setup(creation({ images: [creation().images[0]] }));
    renderApp(`/creations/${ID}`);
    await screen.findByRole("heading", { name: "Floral Birthday Cake", level: 1 });
    expect(screen.queryByRole("list", { name: "More photos" })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/KSh|Ksh|price:|in stock|available now|rating/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Ask them directly about pricing and availability/),
    ).toBeInTheDocument();
  });

  it("offers a retry when the main photo fails", async () => {
    setup();
    const u = userEvent.setup();
    renderApp(`/creations/${ID}`);
    fireEvent.error(await screen.findByAltText("Floral Birthday Cake by Cakes by Maria"));
    expect(await screen.findByText("Photo unavailable")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByAltText("Floral Birthday Cake by Cakes by Maria"),
    ).toBeInTheDocument();
  });

  it("shows related creations that link to their own pages", async () => {
    setup();
    renderApp(`/creations/${ID}`);
    const section = await screen.findByRole("region", { name: "You might also like" });
    expect(await within(section).findByRole("link", { name: "Creation 1" })).toHaveAttribute(
      "href",
      "/creations/00000000-0000-4000-8000-000000000001",
    );
  });

  it("leaves out the related section when there is nothing similar", async () => {
    setup(creation(), []);
    renderApp(`/creations/${ID}`);
    await screen.findByRole("heading", { name: "Floral Birthday Cake", level: 1 });
    await screen.findByRole("region", { name: "About the business" });
    expect(screen.queryByText("You might also like")).not.toBeInTheDocument();
  });

  it("shows a friendly page for creations that are not public", async () => {
    mockApi({
      [`GET /api/public/creations/${ID}`]: {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "Creation not found" } },
      },
    });
    renderApp(`/creations/${ID}`);
    expect(await screen.findByRole("heading", { name: "Creation not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Explore" })).toHaveAttribute(
      "href",
      "/explore",
    );
  });

  it("offers a retry on server errors", async () => {
    mockApi({
      [`GET /api/public/creations/${ID}`]: {
        status: 500,
        body: { error: { code: "INTERNAL_ERROR", message: "x" } },
      },
    });
    renderApp(`/creations/${ID}`);
    expect(
      await screen.findByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
