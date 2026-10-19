import { KENYAN_COUNTIES } from "@kreatespace/shared";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CloseIcon, SearchIcon } from "../components/icons";
import { FormMessage, SecondaryButton } from "../components/forms";
import { GallerySkeleton, LoadMore, Masonry } from "../components/gallery";
import {
  useCities,
  useCreationFeed,
  useFilterOptions,
  type DiscoveryFilters,
} from "../lib/queries";

type FilterKey = keyof DiscoveryFilters;
const FILTER_KEYS: FilterKey[] = ["q", "category", "occasion", "county", "city"];
const SEARCH_DELAY_MS = 300;

const selectClasses =
  "w-full rounded-lg border border-sand bg-white px-3 py-2 text-sm disabled:opacity-60";

export function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const options = useFilterOptions();

  // The address bar is the source of truth, so results can be shared and the back button works.
  const filters = useMemo<DiscoveryFilters>(() => {
    const county = params.get("county") ?? "";
    return {
      q: params.get("q")?.trim() || undefined,
      category: params.get("category") || undefined,
      occasion: params.get("occasion") || undefined,
      county: (KENYAN_COUNTIES as readonly string[]).includes(county) ? county : undefined,
      city: params.get("city") || undefined,
    };
  }, [params]);

  function update(next: Partial<Record<FilterKey, string>>, options?: { replace?: boolean }) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    // Changing the county invalidates the chosen city.
    if ("county" in next) merged.delete("city");
    setParams(merged, { replace: options?.replace ?? false });
  }

  const activeCount = FILTER_KEYS.filter((key) => key !== "q" && filters[key]).length;
  const hasAnyFilter = activeCount > 0 || Boolean(filters.q);

  // --- search box: debounced into the URL, cleared in one tap --------------------------
  const urlQuery = filters.q ?? "";
  const [text, setText] = useState(urlQuery);
  // Follow outside changes to the address (header search, back button) without an effect.
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  if (seenUrlQuery !== urlQuery) {
    setSeenUrlQuery(urlQuery);
    setText(urlQuery);
  }
  useEffect(() => {
    if (text.trim() === urlQuery) return;
    const timer = setTimeout(() => update({ q: text.trim() }, { replace: true }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `update` changes with every URL change
  }, [text, urlQuery]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const cities = useCities(filters.county);
  const feed = useCreationFeed(filters);
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  const categoryName = options.data?.categories.find((c) => c.slug === filters.category)?.name;
  const summary = [
    filters.q ? `“${filters.q}”` : null,
    categoryName ?? filters.category,
    options.data?.occasions.find((o) => o.slug === filters.occasion)?.name,
    [filters.city, filters.county].filter(Boolean).join(", ") || null,
  ].filter(Boolean);

  function clearAll() {
    setText("");
    setParams(new URLSearchParams());
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Explore creations</h1>

      <form role="search" onSubmit={(event) => event.preventDefault()} className="mt-4">
        <label htmlFor="explore-search" className="sr-only">
          Search creations, businesses and occasions
        </label>
        <div className="relative max-w-2xl">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
          <input
            id="explore-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Try “birthday cakes”, “bridal makeup”, “wedding photographers”"
            autoComplete="off"
            enterKeyHint="search"
            className="w-full rounded-full border border-sand bg-white py-3 pl-11 pr-11 text-base shadow-sm"
          />
          {text ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setText("");
                update({ q: "" });
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-muted hover:bg-cream-dark"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      </form>

      <nav aria-label="Categories" className="-mx-4 mt-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-2 pb-1">
          <li>
            <CategoryChip active={!filters.category} onClick={() => update({ category: "" })}>
              All
            </CategoryChip>
          </li>
          {(options.data?.categories ?? []).map((category) => (
            <li key={category.slug}>
              <CategoryChip
                active={filters.category === category.slug}
                onClick={() => update({ category: category.slug })}
              >
                {category.name}
              </CategoryChip>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-3">
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="more-filters"
          onClick={() => setFiltersOpen((open) => !open)}
          className="rounded-full border border-sand bg-white px-4 py-2 text-sm font-medium md:hidden"
        >
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
        <fieldset
          id="more-filters"
          className={`${filtersOpen ? "grid" : "hidden"} mt-3 gap-3 md:mt-0 md:grid md:max-w-3xl md:grid-cols-3`}
        >
          <legend className="sr-only">Filter creations</legend>
          <div>
            <label
              htmlFor="filter-occasion"
              className="mb-1 block text-xs font-medium text-ink-muted"
            >
              Occasion
            </label>
            <select
              id="filter-occasion"
              value={filters.occasion ?? ""}
              onChange={(event) => update({ occasion: event.target.value })}
              className={selectClasses}
            >
              <option value="">Any occasion</option>
              {(options.data?.occasions ?? []).map((occasion) => (
                <option key={occasion.slug} value={occasion.slug}>
                  {occasion.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="filter-county"
              className="mb-1 block text-xs font-medium text-ink-muted"
            >
              County
            </label>
            <select
              id="filter-county"
              value={filters.county ?? ""}
              onChange={(event) => update({ county: event.target.value })}
              className={selectClasses}
            >
              <option value="">All of Kenya</option>
              {KENYAN_COUNTIES.map((county) => (
                <option key={county} value={county}>
                  {county}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-city" className="mb-1 block text-xs font-medium text-ink-muted">
              City or town
            </label>
            <select
              id="filter-city"
              value={filters.city ?? ""}
              disabled={!filters.county}
              onChange={(event) => update({ city: event.target.value })}
              className={selectClasses}
            >
              <option value="">
                {filters.county ? "Any city or town" : "Choose a county first"}
              </option>
              {(cities.data ?? []).map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      </div>

      {hasAnyFilter ? (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span>Showing creations for {summary.join(" · ")}</span>
          <button
            type="button"
            onClick={clearAll}
            className="font-medium text-terracotta underline"
          >
            Clear all
          </button>
        </p>
      ) : null}

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
          hasAnyFilter ? (
            <div className="rounded-2xl border border-sand bg-white p-8 text-center">
              <h2 className="text-xl font-semibold">No creations match your search</h2>
              <p className="mt-2 text-ink-muted">
                Try a different word, a nearby county, or remove a filter.
              </p>
              <SecondaryButton type="button" className="mt-4" onClick={clearAll}>
                Clear search and filters
              </SecondaryButton>
            </div>
          ) : (
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
          )
        ) : (
          <>
            <Masonry items={items} heading="Creations" />
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

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-terracotta bg-terracotta text-white"
          : "border-sand bg-white hover:bg-cream-dark"
      }`}
    >
      {children}
    </button>
  );
}
