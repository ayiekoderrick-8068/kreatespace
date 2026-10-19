import { Link } from "react-router";
import { FormMessage, SecondaryButton } from "../components/forms";
import { GallerySkeleton, LoadMore, Masonry } from "../components/gallery";
import { useCreationFeed } from "../lib/queries";

export function ExplorePage() {
  const feed = useCreationFeed({});
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Explore creations</h1>
      <p className="mt-2 text-ink-muted">Fresh work from Kenyan creative businesses.</p>

      <div className="mt-6" aria-live="polite">
        {feed.isPending ? (
          <GallerySkeleton />
        ) : feed.isError ? (
          <div className="space-y-3">
            <FormMessage kind="error">We couldn’t load creations right now.</FormMessage>
            <SecondaryButton type="button" onClick={() => void feed.refetch()}>
              Try again
            </SecondaryButton>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-sand bg-white p-8 text-center">
            <h2 className="text-xl font-semibold">Nothing here yet</h2>
            <p className="mt-2 text-ink-muted">
              New creations will appear as businesses are approved.
            </p>
            <Link
              to="/for-businesses"
              className="mt-4 inline-block font-medium text-terracotta underline"
            >
              Run a creative business?
            </Link>
          </div>
        ) : (
          <>
            <Masonry items={items} />
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
