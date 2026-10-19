import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { card, page } from "../test/fixtures";
import { mockApi, type MockResponse } from "../test/mockApi";
import { renderApp } from "../test/renderWithProviders";

const FILTERS = {
  categories: [
    { slug: "cakes", name: "Cakes" },
    { slug: "beauty", name: "Beauty" },
    { slug: "photography", name: "Photography" },
  ],
  occasions: [
    { slug: "birthday", name: "Birthday" },
    { slug: "wedding", name: "Wedding" },
  ],
};

function setup(feed: (query: URLSearchParams) => MockResponse["body"] = () => page([card(1)])) {
  return mockApi({
    "GET /api/public/filters": { body: FILTERS },
    "GET /api/public/creations": ({ url }) => ({ body: feed(url.searchParams) }),
    "GET /api/public/cities": ({ url }) => ({
      body: { cities: url.searchParams.get("county") === "Kisumu" ? ["Kisumu", "Milimani"] : [] },
    }),
  });
}

const feedCalls = (api: ReturnType<typeof mockApi>) =>
  api.calls.filter((c) => c.path.startsWith("/api/public/creations"));
const lastFeed = (api: ReturnType<typeof mockApi>) =>
  new URL(feedCalls(api).at(-1)!.path, "http://x").searchParams;

describe("discovery search", () => {
  it("searches as the customer types, after a short pause, and puts the search in the URL", async () => {
    const api = setup();
    const u = userEvent.setup();
    const { router } = renderApp("/explore");
    await screen.findByRole("link", { name: "Creation 1" });

    await u.type(screen.getByRole("searchbox", { name: /Search creations/ }), "birthday cakes");
    await waitFor(() => expect(lastFeed(api).get("q")).toBe("birthday cakes"));
    expect(router.state.location.search).toBe("?q=birthday+cakes");
    // Not one request per keystroke.
    expect(feedCalls(api).length).toBeLessThanOrEqual(3);
  });

  it("starts from the address, so a shared link shows the same results", async () => {
    const api = setup();
    renderApp(
      "/explore?q=bridal%20makeup&category=beauty&county=Kisumu&city=Milimani&occasion=wedding",
    );
    await screen.findByRole("link", { name: "Creation 1" });
    expect(lastFeed(api).toString()).toBe(
      "q=bridal+makeup&category=beauty&occasion=wedding&county=Kisumu&city=Milimani&page=1",
    );
    expect(screen.getByRole("searchbox")).toHaveValue("bridal makeup");
    expect(screen.getByRole("button", { name: "Beauty" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("County")).toHaveValue("Kisumu");
    expect(screen.getByText(/Showing creations for/)).toHaveTextContent(
      "“bridal makeup” · Beauty · Wedding · Milimani, Kisumu",
    );
  });

  it("clears the search in one tap", async () => {
    const api = setup();
    const u = userEvent.setup();
    const { router } = renderApp("/explore?q=wedding");
    await screen.findByRole("link", { name: "Creation 1" });
    await u.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    await waitFor(() => expect(lastFeed(api).get("q")).toBeNull());
  });

  it("shows a helpful no-results state with a way out", async () => {
    setup(() => page([]));
    const u = userEvent.setup();
    const { router } = renderApp("/explore?q=submarine");
    expect(await screen.findByText("No creations match your search")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("shows a loading state and an error with retry", async () => {
    let fail = true;
    mockApi({
      "GET /api/public/filters": { body: FILTERS },
      "GET /api/public/creations": () =>
        fail
          ? { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } }
          : { body: page([card(1)]) },
    });
    const u = userEvent.setup();
    renderApp("/explore?q=cake");
    expect(screen.getByLabelText("Loading creations")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fail = false;
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Creation 1" })).toBeInTheDocument();
  });

  it("is reachable from the header search box on any page", async () => {
    setup();
    const u = userEvent.setup();
    const { router } = renderApp("/about");
    await u.type(screen.getByRole("searchbox"), "wedding photographers{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/explore"));
    expect(router.state.location.search).toBe("?q=wedding%20photographers");
  });
});

describe("category, occasion and location filters", () => {
  it("lists the creative categories as accessible toggle buttons", async () => {
    setup();
    renderApp("/explore");
    const nav = await screen.findByRole("navigation", { name: "Categories" });
    await within(nav).findByRole("button", { name: "Photography" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["All", "Cakes", "Beauty", "Photography"]);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("filters by category and reflects it in the URL", async () => {
    const api = setup();
    const u = userEvent.setup();
    const { router } = renderApp("/explore");
    await u.click(await screen.findByRole("button", { name: "Cakes" }));
    await waitFor(() => expect(lastFeed(api).get("category")).toBe("cakes"));
    expect(router.state.location.search).toBe("?category=cakes");
    await u.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("combines category, county, city and occasion", async () => {
    const api = setup();
    const u = userEvent.setup({ applyAccept: false });
    const { router } = renderApp("/explore");
    await u.click(await screen.findByRole("button", { name: "Cakes" }));
    await u.selectOptions(screen.getByLabelText("County"), "Kisumu");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Milimani" })).toBeInTheDocument(),
    );
    await u.selectOptions(screen.getByLabelText("City or town"), "Milimani");
    await u.selectOptions(screen.getByLabelText("Occasion"), "wedding");

    await waitFor(() =>
      expect(lastFeed(api).toString()).toBe(
        "category=cakes&occasion=wedding&county=Kisumu&city=Milimani&page=1",
      ),
    );
    expect(router.state.location.search).toBe(
      "?category=cakes&county=Kisumu&city=Milimani&occasion=wedding",
    );
  });

  it("needs a county before offering cities, and drops the city when the county changes", async () => {
    setup();
    const u = userEvent.setup();
    const { router } = renderApp("/explore?county=Kisumu&city=Milimani");
    await screen.findByRole("link", { name: "Creation 1" });
    await u.selectOptions(screen.getByLabelText("County"), "Nairobi");
    await waitFor(() => expect(router.state.location.search).toBe("?county=Nairobi"));

    await u.selectOptions(screen.getByLabelText("County"), "");
    expect(screen.getByLabelText("City or town")).toBeDisabled();
    expect(screen.getByRole("option", { name: "Choose a county first" })).toBeInTheDocument();
  });

  it("ignores a made-up county in the address", async () => {
    const api = setup();
    renderApp("/explore?county=Atlantis");
    await screen.findByRole("link", { name: "Creation 1" });
    expect(lastFeed(api).get("county")).toBeNull();
  });

  it("collapses the extra filters on phones and shows how many are active", async () => {
    setup();
    const u = userEvent.setup();
    renderApp("/explore?occasion=wedding&county=Kisumu");
    const toggle = await screen.findByRole("button", { name: "Filters (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await u.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Occasion")).toHaveValue("wedding");
  });

  it("clears every filter at once", async () => {
    setup();
    const u = userEvent.setup();
    const { router } = renderApp("/explore?q=cake&category=cakes&county=Kisumu");
    await u.click(await screen.findByRole("button", { name: "Clear all" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });
});
