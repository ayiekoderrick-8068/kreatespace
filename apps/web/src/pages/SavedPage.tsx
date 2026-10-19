import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { FormMessage, SecondaryButton } from "../components/forms";
import { GallerySkeleton, LoadMore, Masonry } from "../components/gallery";
import { useSavedFeed } from "../lib/queries";

export function SavedPage() {
  const { loading, session } = useAuth();
  const feed = useSavedFeed(Boolean(session));
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10" role="status">
        Loading…
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Your saved creations</h1>
        <p className="mt-3 text-ink-muted">
          Log in to keep a list of the creations you love, so you can come back to them any time.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            to="/login"
            state={{ from: "/saved" }}
            className="rounded-full bg-terracotta px-5 py-2.5 font-medium text-white hover:bg-terracotta-dark"
          >
            Log in
          </Link>
          <Link
            to="/register"
            state={{ from: "/saved" }}
            className="rounded-full border border-ink-muted/40 bg-white px-5 py-2.5 font-medium hover:bg-cream-dark"
          >
            Create an account
          </Link>
        </div>
        <p className="mt-8 text-sm text-ink-muted">
          You don’t need an account to browse.{" "}
          <Link to="/explore" className="font-medium text-terracotta underline">
            Explore creations
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Saved creations</h1>
      <div className="mt-6" aria-live="polite">
        {feed.isPending ? (
          <GallerySkeleton />
        ) : feed.isError ? (
          <div className="space-y-3">
            <FormMessage kind="error">We couldn’t load your saved creations.</FormMessage>
            <SecondaryButton type="button" onClick={() => void feed.refetch()}>
              Try again
            </SecondaryButton>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-sand bg-white p-8 text-center">
            <h2 className="text-xl font-semibold">Nothing saved yet</h2>
            <p className="mt-2 text-ink-muted">Tap the heart on any creation to keep it here.</p>
            <Link to="/explore" className="mt-4 inline-block font-medium text-terracotta underline">
              Explore creations
            </Link>
          </div>
        ) : (
          <>
            <Masonry items={items} eagerCount={0} heading="Your saved creations" />
            <LoadMore
              hasMore={Boolean(feed.hasNextPage)}
              loading={feed.isFetchingNextPage}
              onLoadMore={() => void feed.fetchNextPage()}
            />
          </>
        )}
      </div>
    </main>
  );
}
