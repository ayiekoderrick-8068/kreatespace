import type { UserRole } from "@kreatespace/shared";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentUser } from "../lib/queries";

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-3 text-ink-muted">{children}</div>
      <Link to="/" className="mt-6 inline-block font-medium text-terracotta underline">
        Back to home
      </Link>
    </main>
  );
}

/**
 * Hides a page from people without the right role. This is only a convenience for navigation:
 * every API call is authorised again on the server.
 */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { loading, session } = useAuth();
  const location = useLocation();
  const profile = useCurrentUser();

  if (loading || (session && profile.isPending)) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center text-ink-muted" role="status">
        Loading…
      </main>
    );
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (profile.isError || !profile.data) {
    return (
      <Notice title="Something went wrong">We couldn’t load your account. Please try again.</Notice>
    );
  }
  if (!roles.includes(profile.data.role)) {
    return (
      <Notice title="You don’t have access to this page">
        {roles.includes("SELLER")
          ? "Selling on KreateSpace is by invitation during our pilot."
          : "This area is for KreateSpace administrators."}
      </Notice>
    );
  }
  return <>{children}</>;
}
