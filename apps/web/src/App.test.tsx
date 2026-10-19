import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { routes } from "./App";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe("routing", () => {
  it("renders the home page with the tagline", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "KreateSpace" })).toBeInTheDocument();
    expect(screen.getByText("Discover. Connect. Create.")).toBeInTheDocument();
  });

  it("renders a not-found page with a way back for unknown routes", () => {
    renderAt("/does-not-exist");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to discovery" })).toHaveAttribute("href", "/");
  });
});
