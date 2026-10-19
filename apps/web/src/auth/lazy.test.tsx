import type { Session } from "@supabase/supabase-js";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real sign-in library is large, so the provider fetches it only when it is needed. These tests
// replace the library with a fake and watch when it is (and is not) loaded.
const loaded = vi.fn();
const getSession = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("../lib/supabase-config", () => ({
  isSupabaseConfigured: true,
  isGoogleAuthEnabled: false,
}));
vi.mock("../lib/supabase", () => {
  loaded();
  return {
    getSupabase: () => ({
      auth: {
        getSession,
        signInWithPassword,
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
    }),
  };
});

const { AuthProvider, useAuth } = await import("./AuthProvider");

function Probe({ onReady }: { onReady?: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onReady?.(auth);
  return (
    <p>
      {auth.loading ? "loading" : "ready"} / {auth.user?.email ?? "signed out"}
    </p>
  );
}

beforeEach(() => {
  loaded.mockClear();
  getSession.mockReset().mockResolvedValue({ data: { session: null } });
  signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null });
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => vi.resetModules());

describe("loading the sign-in library on demand", () => {
  it("does not fetch it for a visitor who has no session", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("ready / signed out")).toBeInTheDocument();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("fetches it and restores the session when one is stored", async () => {
    window.localStorage.setItem("sb-project-auth-token", "{}");
    getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "maria@example.com" } } as unknown as Session },
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("ready / maria@example.com")).toBeInTheDocument();
  });

  it.each(["#access_token=abc&type=recovery", "?code=oauth-code", "#error_description=expired"])(
    "fetches it when the address is a sign-in redirect (%s)",
    async (suffix) => {
      window.history.replaceState(null, "", `/reset-password${suffix}`);
      render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
      await waitFor(() => expect(getSession).toHaveBeenCalled());
    },
  );

  it("waits for the library when someone signs in before it has loaded, then follows the session", async () => {
    let auth!: ReturnType<typeof useAuth>;
    render(
      <AuthProvider>
        <Probe onReady={(value) => (auth = value)} />
      </AuthProvider>,
    );
    await screen.findByText("ready / signed out");
    expect(getSession).not.toHaveBeenCalled();

    getSession.mockResolvedValue({
      data: { session: { user: { id: "u1", email: "maria@example.com" } } as unknown as Session },
    });
    let result!: { error: string | null };
    await act(async () => {
      result = await auth.signIn("maria@example.com", "password123");
    });
    expect(result.error).toBeNull();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "maria@example.com",
      password: "password123",
    });
    expect(await screen.findByText("ready / maria@example.com")).toBeInTheDocument();
  });

  it("assumes a session may exist when the browser will not let the page look", async () => {
    const spy = vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked");
    });
    window.localStorage.setItem("anything", "x");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    spy.mockRestore();
  });
});
