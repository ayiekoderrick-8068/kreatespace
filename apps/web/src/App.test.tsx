import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockApi, user } from "./test/mockApi";
import { createFakeAuth, fakeSession, renderApp } from "./test/renderWithProviders";

describe("site navigation", () => {
  it("offers the public navigation to visitors", async () => {
    mockApi();
    renderApp("/about");
    const main = screen.getByRole("navigation", { name: "Main" });
    expect(within(main).getByRole("link", { name: "Explore" })).toHaveAttribute("href", "/explore");
    expect(within(main).getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(within(main).getByRole("link", { name: "For Businesses" })).toHaveAttribute(
      "href",
      "/for-businesses",
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/register");
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("has a mobile bottom bar with Home, Search, Saved and Profile", () => {
    mockApi();
    renderApp("/about");
    const bar = screen.getByRole("navigation", { name: "Mobile" });
    expect(within(bar).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(within(bar).getByRole("link", { name: "Search" })).toHaveAttribute("href", "/explore");
    expect(within(bar).getByRole("link", { name: "Saved" })).toHaveAttribute("href", "/saved");
    expect(within(bar).getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/login");
  });

  it("sends signed-in people to their account from the Profile tab", async () => {
    mockApi({ "GET /api/me": user("CUSTOMER") });
    renderApp("/about", createFakeAuth(fakeSession()).client);
    const bar = screen.getByRole("navigation", { name: "Mobile" });
    expect(await within(bar).findByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("shows seller and admin shortcuts only to those roles", async () => {
    mockApi({ "GET /api/me": user("SELLER") });
    renderApp("/about", createFakeAuth(fakeSession()).client);
    expect(await screen.findByRole("link", { name: "Seller dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("lets keyboard users skip to the content", () => {
    mockApi();
    renderApp("/about");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });

  it("renders a not-found page with a way back for unknown routes", () => {
    mockApi();
    renderApp("/does-not-exist");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to discovery" })).toHaveAttribute("href", "/");
  });
});

describe("static pages", () => {
  it("explains KreateSpace without invented figures", () => {
    mockApi();
    renderApp("/about");
    expect(screen.getByRole("heading", { name: "About KreateSpace" })).toBeInTheDocument();
    expect(
      screen.queryByText(/\d[\d,]*\+? (businesses|customers|creations)/i),
    ).not.toBeInTheDocument();
  });

  it("explains how businesses join during the invitation-only pilot", () => {
    mockApi();
    renderApp("/for-businesses");
    expect(screen.getByText(/by invitation/i)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(4);
  });

  it("shows account details to signed-in users and sends visitors to log in", async () => {
    mockApi({ "GET /api/me": user("CUSTOMER") });
    renderApp("/account", createFakeAuth(fakeSession()).client);
    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(await screen.findByText("Customer")).toBeInTheDocument();
  });

  it("redirects anonymous visitors from the account page to login", async () => {
    mockApi();
    renderApp("/account", createFakeAuth().client);
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });
});
