import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { mockApi, user } from "../test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "../test/renderWithProviders";
import { applyPageMeta, staticMetaFor, summarize } from "./page-meta";

const robots = () => document.head.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content;
const description = () =>
  document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content;
const canonical = () =>
  document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href");

beforeEach(() => {
  document.head
    .querySelectorAll('meta[name="robots"], meta[name="description"], link[rel="canonical"]')
    .forEach((el) => el.remove());
  document.title = "";
});

describe("applyPageMeta", () => {
  it("writes the title, description, robots and canonical address", () => {
    applyPageMeta(
      { title: "Floral Cake", description: "A lovely cake.", canonicalPath: "/creations/1" },
      "https://kreatespace.test",
    );
    expect(document.title).toBe("Floral Cake — KreateSpace");
    expect(description()).toBe("A lovely cake.");
    expect(robots()).toBe("index, follow");
    expect(canonical()).toBe("https://kreatespace.test/creations/1");
  });

  it("keeps the home page title as just the site name", () => {
    applyPageMeta({ title: "KreateSpace" });
    expect(document.title).toBe("KreateSpace");
  });

  it("updates in place rather than piling up tags, and drops the canonical for private pages", () => {
    applyPageMeta({ title: "A", canonicalPath: "/a" }, "https://x.test");
    applyPageMeta({ title: "B", canonicalPath: "/b" }, "https://x.test");
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
    applyPageMeta({ title: "Account", noindex: true }, "https://x.test");
    expect(robots()).toBe("noindex, nofollow");
    expect(canonical()).toBeUndefined();
  });

  it("shortens long descriptions at a word", () => {
    const short = summarize("word ".repeat(100), 60);
    expect(short.length).toBeLessThanOrEqual(60);
    expect(short.endsWith("…")).toBe(true);
    expect(summarize("short")).toBe("short");
  });
});

describe("which pages search engines may list", () => {
  it.each([
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/invite/abc123",
    "/account",
    "/saved",
    "/seller",
    "/seller/creations/new",
    "/admin",
    "/admin/businesses",
  ])("keeps %s out of search results", (path) => {
    expect(staticMetaFor(path, "")?.noindex).toBe(true);
  });

  it("lists the public pages with their own descriptions", () => {
    for (const path of ["/", "/explore", "/about", "/for-businesses"]) {
      const meta = staticMetaFor(path, "");
      expect(meta?.noindex, path).toBeFalsy();
    }
    expect(staticMetaFor("/explore", "")?.canonicalPath).toBe("/explore");
    expect(staticMetaFor("/about", "")?.description).toMatch(/Kenya/);
  });

  it("does not list endless search and filter combinations, which duplicate the main page", () => {
    expect(staticMetaFor("/explore", "?q=cake")?.noindex).toBe(true);
    expect(staticMetaFor("/explore", "?county=Kisumu&occasion=wedding")?.noindex).toBe(true);
    expect(staticMetaFor("/explore", "")?.noindex).toBe(false);
  });

  it("leaves creation and business pages to describe themselves, and hides unknown addresses", () => {
    expect(staticMetaFor("/creations/abc", "")).toBeNull();
    expect(staticMetaFor("/businesses/abc", "")).toBeNull();
    expect(staticMetaFor("/no/such/page", "")).toMatchObject({ noindex: true });
  });
});

describe("in the running app", () => {
  it("marks the login page private and the home page public", async () => {
    mockApi({});
    const { unmount } = renderApp("/login");
    await waitFor(() => expect(robots()).toBe("noindex, nofollow"));
    unmount();
    renderApp("/");
    await waitFor(() => expect(robots()).toBe("index, follow"));
    expect(document.title).toBe("KreateSpace");
  });

  it("marks seller and admin areas private", async () => {
    mockApi({ "GET /api/me": user("ADMIN") });
    renderApp("/admin/businesses", createFakeAuth(fakeSession()).client);
    await waitFor(() => expect(robots()).toBe("noindex, nofollow"));
  });

  it("describes a creation with its own title, description and address", async () => {
    mockApi({
      "GET /api/public/creations/c1": {
        body: {
          creation: {
            id: "c1",
            title: "Floral Birthday Cake",
            description: "Three layers of vanilla sponge with fresh flowers.",
            category: { slug: "cakes", name: "Cakes" },
            occasion: null,
            images: [],
            publishedAt: null,
            business: {
              slug: "cakes-by-maria",
              name: "Cakes by Maria",
              county: "Nairobi",
              city: "Westlands",
              logoUrl: null,
              websiteUrl: null,
              whatsappNumber: "+254712345678",
            },
          },
        },
      },
      "GET /api/public/creations/c1/related": { body: { items: [] } },
    });
    renderApp("/creations/c1");
    await waitFor(() => expect(document.title).toBe("Floral Birthday Cake — KreateSpace"));
    expect(description()).toMatch(/vanilla sponge.*Cakes by Maria.*Westlands, Nairobi/);
    expect(robots()).toBe("index, follow");
    expect(canonical()).toBe(`${window.location.origin}/creations/c1`);
  });
});
