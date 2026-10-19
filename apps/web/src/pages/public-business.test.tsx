import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { card } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { createFakeAuth, renderApp } from "../test/renderWithProviders";

const business = {
  slug: "cakes-by-maria",
  businessName: "Cakes by Maria",
  description: "Custom celebration cakes baked fresh to order in Nairobi.",
  category: { slug: "cakes", name: "Cakes" },
  categories: [
    { slug: "cakes", name: "Cakes" },
    { slug: "creative-gifts", name: "Creative Gifts" },
  ],
  creations: [] as ReturnType<typeof card>[],
  hasMoreCreations: false,
  packages: [] as unknown[],
  county: "Nairobi",
  city: "Westlands",
  websiteUrl: "https://cakes-by-maria.vercel.app",
  whatsappNumber: "+254712345678",
  logoUrl: "https://storage.test/logo.jpg",
  images: [{ url: "https://storage.test/1.jpg" }, { url: "https://storage.test/2.jpg" }],
};

function render(body: unknown, status = 200) {
  const api = mockApi({ "GET /api/public/businesses/cakes-by-maria": { status, body } });
  renderApp("/businesses/cakes-by-maria", createFakeAuth().client);
  return api;
}

describe("public business profile", () => {
  it("shows an approved business to visitors who are not logged in", async () => {
    const api = render({ business });
    expect(
      await screen.findByRole("heading", { name: "Cakes by Maria", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Westlands, Nairobi")).toBeInTheDocument();
    expect(screen.getByText(business.description)).toBeInTheDocument();
    expect(screen.getByAltText("Cakes by Maria logo")).toHaveAttribute("src", business.logoUrl);
    expect(screen.getAllByRole("img", { name: /portfolio photo/ })).toHaveLength(2);
    expect(api.calls[0]!.authorization).toBeNull();
    expect(document.title).toBe("Cakes by Maria — KreateSpace");
  });

  it("opens the seller's own WhatsApp with a prepared, encoded message", async () => {
    render({ business });
    const link = await screen.findByRole("link", { name: "Message on WhatsApp" });
    const href = new URL(link.getAttribute("href")!);
    expect(href.origin + href.pathname).toBe("https://wa.me/254712345678");
    expect(href.searchParams.get("text")).toMatch(
      /^Hello Cakes by Maria! I found your business on KreateSpace/,
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("links to the seller's own website when they have one", async () => {
    render({ business });
    const link = await screen.findByRole("link", { name: "Visit website" });
    expect(link).toHaveAttribute("href", "https://cakes-by-maria.vercel.app");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("supports businesses without a website, logo or photos, and invents nothing", async () => {
    render({ business: { ...business, websiteUrl: null, logoUrl: null, images: [] } });
    await screen.findByRole("heading", { name: "Cakes by Maria", level: 1 });
    expect(screen.queryByRole("link", { name: "Visit website" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("Portfolio")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/rating|review|customers served|\d+ orders/i),
    ).not.toBeInTheDocument();
  });

  it("refuses to render an unsafe website address", async () => {
    render({ business: { ...business, websiteUrl: "javascript:alert(1)" } });
    await screen.findByRole("heading", { name: "Cakes by Maria", level: 1 });
    expect(screen.queryByRole("link", { name: "Visit website" })).not.toBeInTheDocument();
  });

  it("hides the WhatsApp action when the number is not valid", async () => {
    render({ business: { ...business, whatsappNumber: "12345" } });
    await screen.findByRole("heading", { name: "Cakes by Maria", level: 1 });
    expect(screen.queryByRole("link", { name: "Message on WhatsApp" })).not.toBeInTheDocument();
  });

  it("shows a friendly page for businesses that are not public", async () => {
    render({ error: { code: "NOT_FOUND", message: "Business not found" } }, 404);
    expect(await screen.findByRole("heading", { name: "Business not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });

  it("shows a retry message on server errors", async () => {
    render({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } }, 500);
    expect(
      await screen.findByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
  });

  it("lists the business's categories as links into discovery", async () => {
    render({ business });
    const list = await screen.findByRole("list", { name: "Categories" });
    expect(within(list).getByRole("link", { name: "Cakes" })).toHaveAttribute(
      "href",
      "/explore?category=cakes",
    );
    expect(within(list).getByRole("link", { name: "Creative Gifts" })).toHaveAttribute(
      "href",
      "/explore?category=creative-gifts",
    );
  });

  it("shows the business's creations, each linking to its page and back to this business", async () => {
    render({
      business: { ...business, creations: [card(1), card(2)], hasMoreCreations: false },
    });
    const section = (await screen.findByRole("heading", { name: "Their work" })).closest(
      "section",
    )!;
    expect(within(section).getByRole("link", { name: "Creation 1" })).toHaveAttribute(
      "href",
      "/creations/00000000-0000-4000-8000-000000000001",
    );
    expect(within(section).getAllByRole("link", { name: "Cakes by Maria" })).toHaveLength(2);
  });

  it("says when only the newest creations are shown", async () => {
    render({ business: { ...business, creations: [card(1)], hasMoreCreations: true } });
    expect(await screen.findByText(/Showing their 1 newest creations/)).toBeInTheDocument();
  });

  it("leaves out the creations section for a business with none yet", async () => {
    render({ business });
    await screen.findByRole("heading", { name: "Cakes by Maria", level: 1 });
    expect(screen.queryByRole("heading", { name: "Their work" })).not.toBeInTheDocument();
  });
});
