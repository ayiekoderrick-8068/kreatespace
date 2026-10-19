import { Link, Navigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { DeletionSection } from "../components/DeletionSection";
import { SecondaryButton } from "../components/forms";
import { useCurrentUser } from "../lib/queries";

const ROLE_LABELS = {
  CUSTOMER: "Customer",
  SELLER: "Business owner",
  ADMIN: "Administrator",
} as const;

export function AccountPage() {
  const { loading, session, user, signOut } = useAuth();
  const profile = useCurrentUser();

  if (loading) {
    return (
      <main className="mx-auto max-w-xl px-4 py-12" role="status">
        Loading…
      </main>
    );
  }
  if (!session || !user) return <Navigate to="/login" replace state={{ from: "/account" }} />;

  const role = profile.data?.role;

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Your account</h1>
      <dl className="mt-6 rounded-2xl border border-sand bg-white p-5 text-sm">
        <div>
          <dt className="font-medium">Email</dt>
          <dd className="text-ink-muted">{user.email}</dd>
        </div>
        {role ? (
          <div className="mt-3">
            <dt className="font-medium">Account type</dt>
            <dd className="text-ink-muted">{ROLE_LABELS[role]}</dd>
          </div>
        ) : null}
      </dl>

      <ul className="mt-6 space-y-3">
        <li>
          <Link to="/saved" className="font-medium text-terracotta underline">
            Saved creations
          </Link>
        </li>
        {role === "SELLER" ? (
          <li>
            <Link to="/seller" className="font-medium text-terracotta underline">
              Seller dashboard
            </Link>
          </li>
        ) : null}
        {role === "ADMIN" ? (
          <li>
            <Link to="/admin" className="font-medium text-terracotta underline">
              Administration
            </Link>
          </li>
        ) : null}
        {role === "CUSTOMER" ? (
          <li>
            <Link to="/for-businesses" className="font-medium text-terracotta underline">
              Run a creative business? Learn how to join
            </Link>
          </li>
        ) : null}
      </ul>

      <SecondaryButton type="button" className="mt-8" onClick={() => void signOut()}>
        Log out
      </SecondaryButton>

      <DeletionSection />
    </main>
  );
}
