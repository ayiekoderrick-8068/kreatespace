import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { PLATFORM_NAME } from "@kreatespace/shared";
import { useAuth } from "../auth/AuthProvider";
import { recallInvite } from "../lib/pending-invite";
import { forgetPendingSave, recallPendingSave } from "../lib/pending-save";
import { queryKeys, useApi, useCurrentUser } from "../lib/queries";
import { HeartIcon, HomeIcon, SearchIcon, UserIcon } from "./icons";

const topLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive ? "bg-cream-dark" : "hover:bg-cream-dark"}`;

const tabLink = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${isActive ? "text-terracotta" : "text-ink-muted"}`;

function HeaderSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [text, setText] = useState("");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const q = text.trim();
    navigate(q ? `/explore?q=${encodeURIComponent(q)}` : "/explore");
  }

  // The homepage and Explore page have their own, larger search boxes.
  if (pathname === "/" || pathname.startsWith("/explore"))
    return <div className="hidden flex-1 md:block" />;

  return (
    <form onSubmit={onSubmit} role="search" className="hidden max-w-xs flex-1 md:block">
      <label htmlFor="header-search" className="sr-only">
        Search creations
      </label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input
          id="header-search"
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search cakes, makeup, décor…"
          className="w-full rounded-full border border-sand bg-white py-2 pl-9 pr-3 text-sm"
        />
      </div>
    </form>
  );
}

/**
 * Finishes a save the visitor started before logging in. Runs once after they sign in and
 * tells them what happened.
 */
function usePendingSave() {
  const { session } = useAuth();
  const api = useApi();
  const queryClient = useQueryClient();
  const running = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session || running.current) return;
    const pending = recallPendingSave();
    if (!pending) return;
    running.current = true;
    api
      .put(`/api/me/saved/${pending.creationId}`)
      .then(() => setNotice(`Saved “${pending.title}” to your list.`))
      .catch(() =>
        setNotice(`We couldn’t save “${pending.title}”. Try the heart on its page again.`),
      )
      .finally(() => {
        forgetPendingSave();
        running.current = false;
        void queryClient.invalidateQueries({ queryKey: ["saved"] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.savedList });
      });
  }, [session, api, queryClient]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  return { notice, dismiss: () => setNotice(null) };
}

export function Layout() {
  const pendingSave = usePendingSave();
  const { user, signOut } = useAuth();
  const { data: profile } = useCurrentUser();
  const pendingInvite = user && profile?.role === "CUSTOMER" ? recallInvite() : null;

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-sand bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link to="/" className="font-display text-xl font-semibold tracking-tight">
            {PLATFORM_NAME}
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            <NavLink to="/explore" className={topLink}>
              Explore
            </NavLink>
            <NavLink to="/about" className={topLink}>
              About
            </NavLink>
            <NavLink to="/for-businesses" className={topLink}>
              For Businesses
            </NavLink>
            {profile?.role === "SELLER" ? (
              <NavLink to="/seller" className={topLink}>
                Seller dashboard
              </NavLink>
            ) : null}
            {profile?.role === "ADMIN" ? (
              <NavLink to="/admin" className={topLink}>
                Admin
              </NavLink>
            ) : null}
          </nav>
          <HeaderSearch />
          <div className="ml-auto flex items-center gap-2 text-sm">
            {user ? (
              <>
                <NavLink to="/saved" className={`${topLink({ isActive: false })} hidden md:block`}>
                  Saved
                </NavLink>
                <NavLink
                  to="/account"
                  className={`${topLink({ isActive: false })} hidden md:block`}
                >
                  Account
                </NavLink>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="hidden font-medium text-terracotta underline md:block"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="rounded-md px-2 py-2 font-medium hover:bg-cream-dark">
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="rounded-full bg-terracotta px-4 py-2 font-medium text-white hover:bg-terracotta-dark"
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

      <div id="main" className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </div>

      <Footer />

      {pendingSave.notice ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-5 py-3 text-sm text-cream shadow-lg md:bottom-6"
        >
          <span className="flex-1">{pendingSave.notice}</span>
          <Link to="/saved" onClick={pendingSave.dismiss} className="font-medium underline">
            View saved
          </Link>
          <button type="button" onClick={pendingSave.dismiss} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}

      <nav
        aria-label="Mobile"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-sand bg-cream pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <NavLink to="/" end className={tabLink}>
          <HomeIcon />
          Home
        </NavLink>
        <NavLink to="/explore" className={tabLink}>
          <SearchIcon />
          Search
        </NavLink>
        <NavLink to="/saved" className={tabLink}>
          <HeartIcon />
          Saved
        </NavLink>
        <NavLink to={user ? "/account" : "/login"} className={tabLink}>
          <UserIcon />
          Profile
        </NavLink>
      </nav>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-sand bg-cream-dark/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 pb-28 sm:grid-cols-3 md:pb-10">
        <div>
          <p className="font-display text-lg font-semibold">{PLATFORM_NAME}</p>
          <p className="mt-1 text-sm text-ink-muted">Discover. Connect. Create.</p>
          <p className="mt-3 max-w-xs text-sm text-ink-muted">
            A home for Kenyan creative businesses, and the people who love their work.
          </p>
        </div>
        <nav aria-label="Explore" className="text-sm">
          <p className="font-medium">Explore</p>
          <ul className="mt-2 space-y-1.5 text-ink-muted">
            <li>
              <Link to="/explore" className="hover:underline">
                All creations
              </Link>
            </li>
            <li>
              <Link to="/explore?category=cakes" className="hover:underline">
                Cakes
              </Link>
            </li>
            <li>
              <Link to="/explore?category=fashion" className="hover:underline">
                Fashion
              </Link>
            </li>
            <li>
              <Link to="/explore?category=photography" className="hover:underline">
                Photography
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Company" className="text-sm">
          <p className="font-medium">KreateSpace</p>
          <ul className="mt-2 space-y-1.5 text-ink-muted">
            <li>
              <Link to="/about" className="hover:underline">
                About
              </Link>
            </li>
            <li>
              <Link to="/for-businesses" className="hover:underline">
                For Businesses
              </Link>
            </li>
            <li>
              <Link to="/account" className="hover:underline">
                Your account
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <p className="border-t border-sand py-4 text-center text-xs text-ink-muted">
        © {new Date().getFullYear()} {PLATFORM_NAME}. Made for Kenya’s creative community.
      </p>
    </footer>
  );
}
