import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { card, page } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderApp } from "../test/renderWithProviders";

describe("discovery gallery", () => {
  it("shows a loading skeleton, then the creations", async () => {
    mockApi({ "GET /api/public/creations": { body: page([card(1), card(2)]) } });
    renderApp("/explore");
    expect(screen.getByLabelText("Loading creations")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByRole("link", { name: "Creation 1" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading creations")).not.toBeInTheDocument();
  });

  it("keeps each card to the photo, title and who made it", async () => {
    mockApi({ "GET /api/public/creations": { body: page([card(1)]) } });
    renderApp("/explore");
    const tile = (await screen.findByRole("heading", { name: "Creation 1" })).closest("article")!;
    expect(within(tile).getByRole("link", { name: "Creation 1" })).toHaveAttribute(
      "href",
      "/creations/00000000-0000-4000-8000-000000000001",
    );
    expect(within(tile).getByRole("link", { name: "Cakes by Maria" })).toHaveAttribute(
      "href",
      "/businesses/cakes-by-maria",
    );
    expect(within(tile).getByText(/Westlands/)).toBeInTheDocument();
    expect(within(tile).getAllByRole("link")).toHaveLength(2);
  });

  it("reserves space for each photo so the layout does not jump while loading", async () => {
    mockApi({ "GET /api/public/creations": { body: page([card(1)]) } });
    renderApp("/explore");
    const img = await screen.findByAltText("Creation 1");
    expect(img).toHaveAttribute("width", "800");
    expect(img).toHaveAttribute("height", "1000");
    expect(img.parentElement).toHaveStyle({ aspectRatio: "1 / 1.250" });
  });

  it("loads the first photos eagerly and the rest lazily", async () => {
    mockApi({
      "GET /api/public/creations": { body: page(Array.from({ length: 8 }, (_, i) => card(i + 1))) },
    });
    renderApp("/explore");
    await screen.findByAltText("Creation 1");
    expect(screen.getByAltText("Creation 1")).toHaveAttribute("loading", "eager");
    expect(screen.getByAltText("Creation 8")).toHaveAttribute("loading", "lazy");
    expect(screen.getByAltText("Creation 8")).toHaveAttribute("decoding", "async");
  });

  it("uses responsive image variants when the server provides them", async () => {
    const image = {
      url: "https://img.test/800.jpg",
      srcSet: "https://img.test/480.jpg 480w, https://img.test/800.jpg 800w",
      width: 800,
      height: 800,
    };
    mockApi({ "GET /api/public/creations": { body: page([card(1, { image })]) } });
    renderApp("/explore");
    const img = await screen.findByAltText("Creation 1");
    expect(img).toHaveAttribute("srcset", image.srcSet);
    expect(img).toHaveAttribute("sizes");
  });

  it("loads one page at a time and only fetches more on request", async () => {
    const api = mockApi({
      "GET /api/public/creations?page=1": { body: page([card(1), card(2)], 1, true) },
      "GET /api/public/creations?page=2": { body: page([card(3)], 2, false) },
    });
    const u = userEvent.setup();
    renderApp("/explore");
    await screen.findByRole("link", { name: "Creation 1" });
    expect(api.calls.filter((c) => c.path.startsWith("/api/public/creations"))).toHaveLength(1);

    await u.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("link", { name: "Creation 3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Creation 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("explains an empty catalogue without inventing content", async () => {
    mockApi({ "GET /api/public/creations": { body: page([]) } });
    renderApp("/explore");
    expect(await screen.findByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("recovers from a failed load", async () => {
    let fail = true;
    mockApi({
      "GET /api/public/creations": () =>
        fail
          ? { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } }
          : { body: page([card(1)]) },
    });
    const u = userEvent.setup();
    renderApp("/explore");
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t load creations/i);
    fail = false;
    await u.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Creation 1" })).toBeInTheDocument();
  });

  it("shows a calm placeholder when a photo fails, and the card still opens the creation", async () => {
    mockApi({ "GET /api/public/creations": { body: page([card(1)]) } });
    renderApp("/explore");
    fireEvent.error(await screen.findByAltText("Creation 1"));
    expect(await screen.findByText("Photo unavailable")).toBeInTheDocument();
    // No button nests inside the card's link; the detail page offers a retry instead.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Creation 1" })).toHaveAttribute(
      "href",
      "/creations/00000000-0000-4000-8000-000000000001",
    );
  });
});
