import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { card, page } from "../test/fixtures";
import { mockApi, user } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";

const C1 = card(1);
const signedIn = () => createFakeAuth(fakeSession()).client;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("saving while logged out", () => {
  it("invites the visitor to log in, remembers the creation, and makes no API call", async () => {
    const api = mockApi({ "GET /api/public/creations": { body: page([C1]) } });
    const u = userEvent.setup();
    renderApp("/explore?category=cakes");

    await u.click(await screen.findByRole("button", { name: "Save “Creation 1”" }));
    const dialog = screen.getByRole("dialog", { name: "Save it for later" });
    expect(within(dialog).getByText(/We’ll save it as soon as you’re in/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(within(dialog).getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(JSON.parse(window.sessionStorage.getItem("kreatespace.pendingSave")!)).toEqual({
      creationId: C1.id,
      title: "Creation 1",
    });
    expect(api.calls.some((c) => c.path.includes("/api/me/saved"))).toBe(false);
  });

  it("can be dismissed with Not now or Escape, and browsing carries on", async () => {
    mockApi({ "GET /api/public/creations": { body: page([C1]) } });
    const u = userEvent.setup();
    renderApp("/explore");
    await u.click(await screen.findByRole("button", { name: "Save “Creation 1”" }));
    await u.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: "Save “Creation 1”" }));
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Creation 1" })).toBeInTheDocument();
  });

  it("works from the creation page too", async () => {
    mockApi({
      [`GET /api/public/creations/${C1.id}`]: {
        body: {
          creation: {
            id: C1.id,
            title: "Creation 1",
            description: "A lovely cake.",
            category: C1.category,
            occasion: null,
            images: [C1.image],
            publishedAt: null,
            business: {
              ...C1.business,
              logoUrl: null,
              websiteUrl: null,
              whatsappNumber: "+254712345678",
            },
          },
        },
      },
      [`GET /api/public/creations/${C1.id}/related`]: { body: page([]) },
    });
    const u = userEvent.setup();
    renderApp(`/creations/${C1.id}`);
    await u.click(await screen.findByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog", { name: "Save it for later" })).toBeInTheDocument();
  });
});

describe("saving while logged in", () => {
  function setup(
    initialIds: string[] = [],
    put = { body: { saved: true } } as { status?: number; body: unknown },
  ) {
    let ids = [...initialIds];
    return mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/public/creations": { body: page([C1, card(2)]) },
      "GET /api/me/saved/ids": () => ({ body: { ids } }),
      [`PUT /api/me/saved/${C1.id}`]: () => {
        if ((put.status ?? 200) < 400) ids = [C1.id, ...ids];
        return put;
      },
      [`DELETE /api/me/saved/${C1.id}`]: () => {
        ids = ids.filter((id) => id !== C1.id);
        return { body: { saved: false } };
      },
    });
  }

  it("saves a creation immediately and tells the server with the user's token", async () => {
    const api = setup();
    const u = userEvent.setup();
    renderApp("/explore", signedIn());
    const heart = await screen.findByRole("button", { name: "Save “Creation 1”" });
    expect(heart).toHaveAttribute("aria-pressed", "false");

    await u.click(heart);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove “Creation 1” from saved" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    const put = api.find("PUT", `/api/me/saved/${C1.id}`)[0]!;
    expect(put.authorization).toBe("Bearer test-access-token");
    expect(await screen.findByText("Saved Creation 1")).toBeInTheDocument();
  });

  it("shows what is already saved and removes it on request", async () => {
    const api = setup([C1.id]);
    const u = userEvent.setup();
    renderApp("/explore", signedIn());
    const heart = await screen.findByRole("button", { name: "Remove “Creation 1” from saved" });
    expect(heart).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save “Creation 2”" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await u.click(heart);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save “Creation 1”" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(api.find("DELETE", `/api/me/saved/${C1.id}`)).toHaveLength(1);
  });

  it("puts the heart back and says so when saving fails", async () => {
    setup([], { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } });
    const u = userEvent.setup();
    renderApp("/explore", signedIn());
    await u.click(await screen.findByRole("button", { name: "Save “Creation 1”" }));
    expect(
      await screen.findByText(/Couldn’t update saved list for Creation 1/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save “Creation 1”" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("finishing a save after logging in", () => {
  it("completes the remembered save and confirms it", async () => {
    window.sessionStorage.setItem(
      "kreatespace.pendingSave",
      JSON.stringify({ creationId: C1.id, title: "Creation 1" }),
    );
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/public/home": { body: { categories: [], recent: [], businesses: [] } },
      [`PUT /api/me/saved/${C1.id}`]: { body: { saved: true } },
    });
    renderApp("/", signedIn());

    expect(await screen.findByText("Saved “Creation 1” to your list.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View saved" })).toHaveAttribute("href", "/saved");
    expect(api.find("PUT", `/api/me/saved/${C1.id}`)).toHaveLength(1);
    expect(window.sessionStorage.getItem("kreatespace.pendingSave")).toBeNull();
  });

  it("explains when the remembered save can't be completed, and does not retry forever", async () => {
    window.sessionStorage.setItem(
      "kreatespace.pendingSave",
      JSON.stringify({ creationId: C1.id, title: "Creation 1" }),
    );
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/public/home": { body: { categories: [], recent: [], businesses: [] } },
      [`PUT /api/me/saved/${C1.id}`]: {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: "Creation not found" } },
      },
    });
    renderApp("/", signedIn());
    expect(await screen.findByText(/We couldn’t save “Creation 1”/)).toBeInTheDocument();
    expect(window.sessionStorage.getItem("kreatespace.pendingSave")).toBeNull();
    expect(api.find("PUT", `/api/me/saved/${C1.id}`)).toHaveLength(1);
  });

  it("does nothing for visitors who haven't logged in", async () => {
    window.sessionStorage.setItem(
      "kreatespace.pendingSave",
      JSON.stringify({ creationId: C1.id, title: "Creation 1" }),
    );
    const api = mockApi({
      "GET /api/public/home": { body: { categories: [], recent: [], businesses: [] } },
    });
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: /Discover creativity/ });
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
    expect(window.sessionStorage.getItem("kreatespace.pendingSave")).not.toBeNull();
  });
});

describe("saved page", () => {
  it("invites visitors to log in without forcing them", async () => {
    mockApi();
    renderApp("/saved");
    expect(
      await screen.findByRole("heading", { name: "Your saved creations" }),
    ).toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(main.getByRole("link", { name: "Explore creations" })).toHaveAttribute(
      "href",
      "/explore",
    );
  });

  it("lists saved creations and drops one when it is removed", async () => {
    let saved = [C1, card(2)];
    const api = mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/saved": () => ({ body: page(saved) }),
      "GET /api/me/saved/ids": () => ({ body: { ids: saved.map((c) => c.id) } }),
      [`DELETE /api/me/saved/${C1.id}`]: () => {
        saved = saved.filter((c) => c.id !== C1.id);
        return { body: { saved: false } };
      },
    });
    const u = userEvent.setup();
    renderApp("/saved", signedIn());

    expect(await screen.findByRole("heading", { name: "Saved creations" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Creation 1" })).toBeInTheDocument();
    expect(api.find("GET", "/api/me/saved?page=1")[0]!.authorization).toBe(
      "Bearer test-access-token",
    );

    await u.click(await screen.findByRole("button", { name: "Remove “Creation 1” from saved" }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Creation 1" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Creation 2" })).toBeInTheDocument();
  });

  it("has a friendly empty state", async () => {
    mockApi({
      "GET /api/me": user("CUSTOMER"),
      "GET /api/me/saved": { body: page([]) },
      "GET /api/me/saved/ids": { body: { ids: [] } },
    });
    renderApp("/saved", signedIn());
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
  });
});
