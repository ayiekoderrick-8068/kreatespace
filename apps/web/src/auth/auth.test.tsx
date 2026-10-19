import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFakeAuth, fakeSession, renderApp, type FakeAuth } from "../test/renderWithProviders";

let fake: FakeAuth;

beforeEach(() => {
  fake = createFakeAuth();
});

describe("login", () => {
  it("shows validation errors without calling Supabase", async () => {
    const user = userEvent.setup();
    renderApp("/login", fake.client);
    await user.click(await screen.findByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Password is required")).toBeInTheDocument();
    expect(fake.mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in and returns to the home page", async () => {
    const user = userEvent.setup();
    renderApp("/login", fake.client);
    await user.type(await screen.findByLabelText("Email"), "Maria@Example.com");
    await user.type(screen.getByLabelText("Password"), "bakery2024");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(fake.mocks.signInWithPassword).toHaveBeenCalledWith({
        email: "maria@example.com",
        password: "bakery2024",
      }),
    );
    expect(await screen.findByRole("heading", { name: "KreateSpace" })).toBeInTheDocument();
  });

  it("shows the error returned by Supabase", async () => {
    fake.mocks.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });
    const user = userEvent.setup();
    renderApp("/login", fake.client);
    await user.type(await screen.findByLabelText("Email"), "maria@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
  });

  it("explains when authentication is not configured and disables submission", async () => {
    renderApp("/login", null);
    expect(await screen.findByText(/authentication is not configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });
});

describe("registration", () => {
  async function fillForm(user: ReturnType<typeof userEvent.setup>, confirm = "bakery2024") {
    await user.type(await screen.findByLabelText("Full name"), "Maria Wanjiku");
    await user.type(screen.getByLabelText("Email"), "maria@example.com");
    await user.type(screen.getByLabelText("Password"), "bakery2024");
    await user.type(screen.getByLabelText("Confirm password"), confirm);
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  it("rejects mismatched passwords", async () => {
    const user = userEvent.setup();
    renderApp("/register", fake.client);
    await fillForm(user, "different1");
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(fake.mocks.signUp).not.toHaveBeenCalled();
  });

  it("creates the account and asks the user to verify their email", async () => {
    const user = userEvent.setup();
    renderApp("/register", fake.client);
    await fillForm(user);

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText("maria@example.com")).toBeInTheDocument();
    expect(fake.mocks.signUp).toHaveBeenCalledWith({
      email: "maria@example.com",
      password: "bakery2024",
      options: {
        data: { full_name: "Maria Wanjiku" },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
  });

  it("shows sign-up errors", async () => {
    fake.mocks.signUp.mockResolvedValue({
      data: { session: null },
      error: { message: "User already registered" },
    });
    const user = userEvent.setup();
    renderApp("/register", fake.client);
    await fillForm(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("User already registered");
  });
});

describe("password recovery", () => {
  it("sends a reset email and shows a non-revealing confirmation", async () => {
    const user = userEvent.setup();
    renderApp("/forgot-password", fake.client);
    await user.type(await screen.findByLabelText("Email"), "maria@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/if an account exists/i);
    expect(fake.mocks.resetPasswordForEmail).toHaveBeenCalledWith("maria@example.com", {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  });

  it("tells visitors without a recovery session that the link has expired", async () => {
    renderApp("/reset-password", fake.client);
    expect(await screen.findByRole("heading", { name: "Link expired" })).toBeInTheDocument();
  });

  it("lets a user with a recovery link set a new password", async () => {
    const user = userEvent.setup();
    renderApp("/reset-password", fake.client);
    await screen.findByRole("heading", { name: "Link expired" });

    act(() => fake.emit("PASSWORD_RECOVERY", fakeSession()));
    await user.type(await screen.findByLabelText("New password"), "newbread99");
    await user.type(screen.getByLabelText("Confirm new password"), "newbread99");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(fake.mocks.updateUser).toHaveBeenCalledWith({ password: "newbread99" }),
    );
    expect(await screen.findByRole("heading", { name: "KreateSpace" })).toBeInTheDocument();
  });
});

describe("session state", () => {
  it("shows the signed-in user and logs out", async () => {
    fake = createFakeAuth(fakeSession("maria@example.com"));
    const user = userEvent.setup();
    renderApp("/", fake.client);

    expect(await screen.findByText("Signed in as maria@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(fake.mocks.signOut).toHaveBeenCalled();
  });
});
