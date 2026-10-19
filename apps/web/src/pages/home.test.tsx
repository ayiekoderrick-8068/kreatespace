import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { HomeData } from "../lib/types";
import { card } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp } from "../test/renderWithProviders";

const image = (name: string) => ({
  url: `/dev-fixtures/${name}.svg`,
  srcSet: null,
  width: 800,
  height: 800,
});

function homeData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    categories: [
      { slug: "cakes", name: "Cakes", count: 3, cover: image("cake") },
      { slug: "fashion", name: "Fashion", count: 1, cover: image("dress") },
      { slug: "flowers", name: "Flowers", count: 0, cover: null },
      { slug: "other", name: "Other", count: 0, cover: null },
    ],
    recent: [card(1), card(2), card(3)],
    businesses: [
      {
        slug: "cakes-by-maria",
        name: "Cakes by Maria",
        county: "Nairobi",
        city: "Westlands",
        categoryName: "Cakes",
        logoUrl: null,
        creationCount: 3,
        previews: [image("a"), image("b")],
      },
    ],
    ...overrides,
  };
}

const withHome = (data: HomeData) => mockApi({ "GET /api/public/home": { body: data } });

describe("homepage", () => {
  it("states the proposition and offers search straight away", async () => {
    withHome(homeData());
    renderApp("/");
    expect(
      screen.getByRole("heading", { level: 1, name: /Discover creativity\.\s*Meet the creator\./ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search creations" })).toBeInTheDocument();
    await screen.findByText("Browse by category");
  });

  it("sends the search to the Explore page", async () => {
    withHome(homeData());
    const u = userEvent.setup();
    const { router } = renderApp("/");
    await u.type(screen.getByRole("searchbox", { name: "Search creations" }), "birthday cakes");
    await u.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/explore"));
    expect(router.state.location.search).toBe("?q=birthday%20cakes");
  });

  it("previews categories with real counts and covers, and hides the catch-all", async () => {
    withHome(homeData());
    renderApp("/");
    const section = (await screen.findByRole("heading", { name: "Browse by category" })).closest(
      "section",
    )!;
    const cakes = within(section).getByRole("link", { name: /Cakes/ });
    expect(cakes).toHaveAttribute("href", "/explore?category=cakes");
    expect(within(cakes).getByText("3 creations")).toBeInTheDocument();
    expect(within(section).getByText("1 creation")).toBeInTheDocument();
    // Empty categories show no count rather than "0 creations".
    expect(within(section).getByRole("link", { name: /Flowers/ })).not.toHaveTextContent(
      /creation/,
    );
    expect(within(section).queryByRole("link", { name: /Other/ })).not.toBeInTheDocument();
  });

  it("shows recently published creations and a link to explore them all", async () => {
    withHome(homeData());
    renderApp("/");
    const section = (await screen.findByRole("heading", { name: "Recently published" })).closest(
      "section",
    )!;
    expect(within(section).getAllByRole("article")).toHaveLength(3);
    expect(within(section).getByRole("link", { name: /Explore all/ })).toHaveAttribute(
      "href",
      "/explore",
    );
  });

  it("features real businesses and links to their profiles", async () => {
    withHome(homeData());
    renderApp("/");
    const section = (await screen.findByRole("heading", { name: "Meet the creators" })).closest(
      "section",
    )!;
    const link = within(section).getByRole("link", { name: /Cakes by Maria/ });
    expect(link).toHaveAttribute("href", "/businesses/cakes-by-maria");
    expect(link).toHaveTextContent("Cakes · Westlands, Nairobi");
  });

  it("explains how it works and invites business owners", async () => {
    withHome(homeData());
    renderApp("/");
    const how = screen.getByRole("heading", { name: "How KreateSpace works" }).closest("section")!;
    expect(
      within(how)
        .getAllByRole("listitem")
        .map((li) => li.querySelector("h3")?.textContent),
    ).toEqual(["Discover", "Explore", "Connect"]);
    expect(screen.getByRole("link", { name: /Learn how to join/ })).toHaveAttribute(
      "href",
      "/for-businesses",
    );
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("is honest on a brand-new platform: no fake listings, businesses or numbers", async () => {
    withHome(
      homeData({
        recent: [],
        businesses: [],
        categories: homeData().categories.map((c) => ({ ...c, count: 0, cover: null })),
      }),
    );
    renderApp("/");
    expect(await screen.findByText("New creations are on their way")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Meet the creators" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ creations?/)).not.toBeInTheDocument();
    expect(screen.queryByText(/rating|reviews|customers served/i)).not.toBeInTheDocument();
  });

  it("uses recent creations in the hero when there are some", async () => {
    withHome(homeData());
    renderApp("/");
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    await within(hero).findByRole("list", { name: "Recent creations" });
  });

  it("still works if the latest creations can't be loaded", async () => {
    mockApi({
      "GET /api/public/home": {
        status: 500,
        body: { error: { code: "INTERNAL_ERROR", message: "x" } },
      },
    });
    renderApp("/");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn’t load the latest creations/i,
    );
    expect(screen.getByRole("link", { name: "explore all creations" })).toHaveAttribute(
      "href",
      "/explore",
    );
    expect(screen.getByRole("searchbox", { name: "Search creations" })).toBeInTheDocument();
  });
});
