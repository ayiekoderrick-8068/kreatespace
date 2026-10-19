import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { CreationCard, ImageView } from "../lib/types";
import { SaveButton } from "./SaveButton";

/** Keeps tall or wide photos from dominating the grid; the image is cropped to fit. */
function boundedRatio(image: ImageView | null): string {
  if (!image || image.width <= 0 || image.height <= 0) return "4 / 5";
  const heightOverWidth = Math.min(1.5, Math.max(0.7, image.height / image.width));
  return `1 / ${heightOverWidth.toFixed(3)}`;
}

/**
 * An image in a box whose shape is known up front, so the page never jumps when it loads.
 * Failed images show a calm placeholder with a retry button.
 */
export function Photo({
  image,
  alt,
  sizes,
  eager = false,
  fit = "cover",
  allowRetry = true,
  className = "",
}: {
  image: ImageView | null;
  alt: string;
  sizes?: string;
  eager?: boolean;
  fit?: "cover" | "contain";
  /** Off inside links: a button must not be nested in an anchor. */
  allowRetry?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ratio =
    fit === "cover" ? boundedRatio(image) : `${image?.width ?? 4} / ${image?.height ?? 5}`;

  return (
    <div
      style={{ aspectRatio: ratio }}
      className={`relative w-full overflow-hidden bg-cream-dark ${className}`}
    >
      {image?.url && !failed ? (
        <img
          key={attempt}
          src={image.url}
          srcSet={image.srcSet ?? undefined}
          sizes={image.srcSet ? (sizes ?? "(min-width: 1024px) 25vw, 50vw") : undefined}
          alt={alt}
          width={image.width}
          height={image.height}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={eager ? "high" : undefined}
          onError={() => setFailed(true)}
          className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-center text-sm text-ink-muted">
          <span>Photo unavailable</span>
          {image?.url && allowRetry ? (
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
              className="rounded-full border border-sand bg-white px-3 py-1 text-xs font-medium text-ink"
            >
              Try again
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** One creation in the grid: the photo leads, with just a title and who made it. */
export function CreationTile({
  creation,
  eager = false,
}: {
  creation: CreationCard;
  eager?: boolean;
}) {
  return (
    <article className="group">
      <div className="relative overflow-hidden rounded-2xl">
        <Link
          to={`/creations/${creation.id}`}
          aria-label={creation.title}
          className="block transition-transform duration-300 group-hover:scale-[1.015]"
        >
          <Photo image={creation.image} alt={creation.title} eager={eager} allowRetry={false} />
        </Link>
        <div className="absolute right-2 top-2">
          <SaveButton creationId={creation.id} title={creation.title} />
        </div>
      </div>
      <div className="px-1 pb-1 pt-2">
        <h3 className="line-clamp-2 font-sans text-sm font-medium leading-snug">
          {creation.title}
        </h3>
        <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">
          <Link to={`/businesses/${creation.business.slug}`} className="hover:underline">
            {creation.business.name}
          </Link>
          {" · "}
          {creation.business.city}
        </p>
      </div>
    </article>
  );
}

/** Pinterest-style columns: two on phones, more as the screen grows. */
export function Masonry({
  items,
  eagerCount = 4,
}: {
  items: CreationCard[];
  /** The first few images load immediately; the rest load as they approach the screen. */
  eagerCount?: number;
}) {
  return (
    <ul className="columns-2 gap-3 sm:gap-4 md:columns-3 lg:columns-4 2xl:columns-5">
      {items.map((creation, index) => (
        <li key={creation.id} className="mb-4 break-inside-avoid">
          <CreationTile creation={creation} eager={index < eagerCount} />
        </li>
      ))}
    </ul>
  );
}

const SKELETON_RATIOS = ["4 / 5", "1 / 1", "3 / 4", "4 / 3", "4 / 5", "1 / 1", "3 / 4", "1 / 1"];

export function GallerySkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading creations"
      className="columns-2 gap-3 sm:gap-4 md:columns-3 lg:columns-4 2xl:columns-5"
    >
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="mb-4 break-inside-avoid">
          <div
            className="skeleton w-full rounded-2xl"
            style={{ aspectRatio: SKELETON_RATIOS[index % SKELETON_RATIOS.length] }}
          />
          <div className="skeleton mt-2 h-3 w-3/4 rounded" />
          <div className="skeleton mt-1.5 h-3 w-1/2 rounded" />
        </li>
      ))}
    </ul>
  );
}

/**
 * Loads the next page when the end of the list scrolls into view. A visible button is always
 * offered too, for keyboard users and browsers without IntersectionObserver.
 */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef({ loading, onLoadMore });
  useEffect(() => {
    latest.current = { loading, onLoadMore };
  });

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !latest.current.loading) {
          latest.current.onLoadMore();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore]);

  if (!hasMore) return null;
  return (
    <div ref={sentinel} className="mt-8 flex justify-center">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        className="rounded-full border border-ink-muted/40 bg-white px-6 py-2.5 text-sm font-medium hover:bg-cream disabled:opacity-60"
      >
        {loading ? "Loading…" : "Show more"}
      </button>
    </div>
  );
}
