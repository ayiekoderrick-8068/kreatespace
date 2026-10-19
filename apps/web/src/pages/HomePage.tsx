import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@kreatespace/shared";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";

export function HomePage() {
  const { user, signOut } = useAuth();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{PLATFORM_NAME}</h1>
      <p className="mt-3 text-lg text-terracotta">{PLATFORM_TAGLINE}</p>
      <p className="mt-6 max-w-prose text-ink-muted">
        Discover Kenyan creative businesses, explore their work, and connect with them directly.
      </p>
      <nav aria-label="Account" className="mt-8 flex items-center gap-4 text-sm">
        {user ? (
          <>
            <span className="text-ink-muted">Signed in as {user.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="font-medium text-terracotta underline"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link to="/login" className="font-medium text-terracotta underline">
              Log in
            </Link>
            <Link
              to="/register"
              className="rounded-md bg-terracotta px-4 py-2 font-medium text-white hover:bg-terracotta-dark"
            >
              Sign up
            </Link>
          </>
        )}
      </nav>
    </main>
  );
}
