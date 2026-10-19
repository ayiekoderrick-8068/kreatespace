import { Link, NavLink, Outlet } from "react-router";
import { PLATFORM_NAME } from "@kreatespace/shared";
import { useAuth } from "../auth/AuthProvider";
import { recallInvite } from "../lib/pending-invite";
import { useCurrentUser } from "../lib/queries";

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${isActive ? "bg-cream-dark" : "hover:bg-cream-dark"}`;

export function Layout() {
  const { user, signOut } = useAuth();
  const { data: profile } = useCurrentUser();
  const pendingInvite = user && profile?.role === "CUSTOMER" ? recallInvite() : null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-cream-dark bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            {PLATFORM_NAME}
          </Link>
          <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-1">
            {profile?.role === "SELLER" ? (
              <NavLink to="/seller" className={navLink}>
                Seller dashboard
              </NavLink>
            ) : null}
            {profile?.role === "ADMIN" ? (
              <NavLink to="/admin" className={navLink}>
                Admin
              </NavLink>
            ) : null}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            {user ? (
              <>
                <span className="hidden text-ink-muted sm:inline">{user.email}</span>
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
                  className="rounded-md bg-terracotta px-3 py-2 font-medium text-white hover:bg-terracotta-dark"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
        {pendingInvite ? (
          <div className="bg-cream-dark px-4 py-2 text-center text-sm">
            You have a seller invitation waiting.{" "}
            <Link to={`/invite/${pendingInvite}`} className="font-medium text-terracotta underline">
              Accept it
            </Link>
          </div>
        ) : null}
      </header>
      <Outlet />
    </div>
  );
}
