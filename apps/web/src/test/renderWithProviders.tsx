import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { vi } from "vitest";
import { createQueryClient, routes } from "../App";
import { AuthProvider, type AuthClient } from "../auth/AuthProvider";

type StateListener = (event: AuthChangeEvent, session: Session | null) => void;

export interface FakeAuth {
  client: AuthClient;
  emit(event: AuthChangeEvent, session: Session | null): void;
  mocks: {
    signInWithPassword: ReturnType<typeof vi.fn>;
    signUp: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    resetPasswordForEmail: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
  };
}

export function createFakeAuth(initialSession: Session | null = null): FakeAuth {
  let listener: StateListener | undefined;
  const mocks = {
    signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null, user: {} }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };

  const client = {
    ...mocks,
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: initialSession }, error: null }),
    onAuthStateChange: vi.fn((callback: StateListener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  } as unknown as AuthClient;

  return { client, mocks, emit: (event, session) => listener?.(event, session) };
}

export function fakeSession(email = "maria@example.com"): Session {
  return {
    user: { id: "user-1", email },
    access_token: "test-access-token",
  } as unknown as Session;
}

export function renderApp(path: string, client: AuthClient | null = null) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={client}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, router, queryClient };
}
