import { screen } from "@testing-library/react";
import { renderApp } from "./test/renderWithProviders";

describe("routing", () => {
  it("renders the home page with the tagline and sign-in links", () => {
    renderApp("/");
    expect(screen.getByRole("heading", { name: "KreateSpace" })).toBeInTheDocument();
    expect(screen.getByText("Discover. Connect. Create.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/register");
  });

  it("renders a not-found page with a way back for unknown routes", () => {
    renderApp("/does-not-exist");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to discovery" })).toHaveAttribute("href", "/");
  });
});
