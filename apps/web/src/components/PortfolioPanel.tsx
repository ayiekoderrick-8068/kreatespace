import { Link } from "react-router";
import { FormMessage } from "./forms";
import { Photo } from "./gallery";
import { StatusBadge } from "./StatusBadge";
import { useOwnCreations } from "../lib/portfolio";
import type { CreationSummary } from "../lib/types";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-cream px-4 py-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function CreationRow({ creation }: { creation: CreationSummary }) {
  const needsAttention = ["CHANGES_REQUESTED", "REJECTED"].includes(creation.revisionStatus);
  return (
    <li className="flex gap-3 rounded-xl border border-sand bg-white p-3">
      <div className="w-20 shrink-0 overflow-hidden rounded-lg">
        {creation.cover ? (
          <Photo
            image={{
              url: creation.cover.url,
              srcSet: null,
              width: creation.cover.width,
              height: creation.cover.height,
            }}
            alt=""
            allowRetry={false}
            sizes="80px"
          />
        ) : (
          <div className="flex aspect-square items-center justify-center bg-cream-dark text-xs text-ink-muted">
            No photo
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          to={`/seller/creations/${creation.id}`}
          className="block truncate font-medium text-terracotta underline"
        >
          {creation.title}
        </Link>
        <p className="mt-0.5 text-xs text-ink-muted">
          {creation.category.name} · {creation.imageCount}{" "}
          {creation.imageCount === 1 ? "photo" : "photos"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusBadge status={creation.status} />
          {creation.hasPublishedVersion && creation.revisionStatus !== "APPROVED" ? (
            <span className="text-xs text-ink-muted">
              Edit: {creation.revisionStatus.replace("_", " ").toLowerCase()}
            </span>
          ) : null}
        </div>
        {needsAttention && creation.latestFeedback?.reason ? (
          <p className="mt-1.5 line-clamp-2 text-xs text-ink-muted">
            “{creation.latestFeedback.reason}”
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** The seller's portfolio at a glance: allowance used, counts by status, and each creation. */
export function PortfolioPanel() {
  const portfolio = useOwnCreations();

  return (
    <section
      className="rounded-xl border border-cream-dark bg-white p-5"
      aria-labelledby="portfolio-heading"
    >
      <h2 id="portfolio-heading" className="text-lg font-semibold">
        Your portfolio
      </h2>

      {portfolio.isPending ? (
        <p role="status" className="mt-3 text-sm text-ink-muted">
          Loading your creations…
        </p>
      ) : portfolio.isError ? (
        <div className="mt-3">
          <FormMessage kind="error">
            We couldn’t load your creations. Please refresh to try again.
          </FormMessage>
        </div>
      ) : (
        <PortfolioBody data={portfolio.data} />
      )}
    </section>
  );
}

function PortfolioBody({
  data,
}: {
  data: NonNullable<ReturnType<typeof useOwnCreations>["data"]>;
}) {
  const { creations, usage } = data;
  const counts = usage.byStatus;
  const full = usage.remaining === 0;
  const needAttention = (counts.CHANGES_REQUESTED ?? 0) + (counts.REJECTED ?? 0);

  return (
    <>
      <p className="mt-2 text-sm">
        <span className="font-medium">
          {usage.used} of {usage.limit} creations used
        </span>
        <span className="text-ink-muted">
          {" "}
          · {usage.remaining} free {usage.remaining === 1 ? "slot" : "slots"} left
        </span>
      </p>
      <div
        role="progressbar"
        aria-label="Free creations used"
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={usage.used}
        className="mt-2 h-2 overflow-hidden rounded-full bg-cream-dark"
      >
        <div
          className={`h-full ${full ? "bg-red-600" : "bg-terracotta"}`}
          style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Published" value={counts.APPROVED ?? 0} />
        <Stat label="Drafts" value={counts.DRAFT ?? 0} />
        <Stat label="Pending review" value={counts.PENDING ?? 0} />
        <Stat label="Needs attention" value={needAttention} />
        <Stat label="Archived" value={counts.ARCHIVED ?? 0} />
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {full ? (
          <p className="text-sm text-ink-muted">
            You’ve used all your free creations. Archive one to add another.
          </p>
        ) : (
          <Link
            to="/seller/creations/new"
            className="rounded-full bg-terracotta px-5 py-2.5 font-medium text-white hover:bg-terracotta-dark"
          >
            Add new creation
          </Link>
        )}
        <Link to="/seller/packages" className="text-sm font-medium text-terracotta underline">
          Manage service packages
        </Link>
      </div>

      {creations.length === 0 ? (
        <p className="mt-5 text-sm text-ink-muted">
          You haven’t added any creations yet. Add your first to show your work in discovery once
          it’s approved.
        </p>
      ) : (
        <ul className="mt-5 grid gap-3 lg:grid-cols-2" aria-label="Your creations">
          {creations.map((creation) => (
            <CreationRow key={creation.id} creation={creation} />
          ))}
        </ul>
      )}
    </>
  );
}
