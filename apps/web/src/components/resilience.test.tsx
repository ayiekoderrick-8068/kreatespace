import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../test/mockApi";
import { renderApp } from "../test/renderWithProviders";
import { ConnectionNotice } from "./ConnectionNotice";
import { AppErrorBoundary, RouteErrorPage } from "./ErrorPage";

function Boom(): never {
  throw new Error(
    "Invalid `prisma.user.create()` invocation: { email: 'maria@example.com' } secret detail",
  );
}

afterEach(() => vi.restoreAllMocks());

describe("when a page crashes", () => {
  it("shows a friendly message with a way out, and none of the technical detail", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const router = createMemoryRouter(
      [{ path: "/", element: <Boom />, errorElement: <RouteErrorPage /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
    expect(document.body.textContent).not.toMatch(/prisma|maria@example|secret detail/);
    // The technical text goes only to the visitor's own browser console, never onto the page.
    expect(logged).toHaveBeenCalledWith("Page crashed", expect.objectContaining({ name: "Error" }));
  });

  it("reloads when the person chooses to try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const router = createMemoryRouter(
      [{ path: "/", element: <Boom />, errorElement: <RouteErrorPage /> }],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("catches crashes outside the router too, so the screen is never blank", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/prisma|secret detail/);
  });

  it("explains an address that does not exist without offering a pointless retry", async () => {
    mockApi({});
    renderApp("/no/such/page");
    expect(await screen.findByText(/couldn’t find/i)).toBeInTheDocument();
  });
});

describe("when the connection drops", () => {
  const setOnline = (value: boolean) =>
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);

  it("says so, and stops saying so when it returns", () => {
    setOnline(true);
    render(<ConnectionNotice />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);

    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("starts out offline when the browser already is", () => {
    setOnline(false);
    render(<ConnectionNotice />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
