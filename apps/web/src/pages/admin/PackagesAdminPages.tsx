import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { FormMessage, SecondaryButton } from "../../components/forms";
import { Photo } from "../../components/gallery";
import { ReviewDecisionPanel } from "../../components/ReviewDecisionPanel";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/queries";
import type { AdminPackageDetail, AdminPackageListItem, PackageView } from "../../lib/types";

const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" });
const dateTime = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" });
const kes = new Intl.NumberFormat("en-KE");

export function PackagesAdminPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const state = params.get("state") ?? "PENDING";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const list = useQuery({
    queryKey: ["admin", "packages", { state, page }],
    queryFn: () =>
      api.get<{ items: AdminPackageListItem[]; total: number; pageSize: number }>(
        `/api/admin/packages?${new URLSearchParams({ ...(state ? { state } : {}), page: String(page) })}`,
      ),
  });

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="package-state" className="sr-only">
          Filter packages by review state
        </label>
        <select
          id="package-state"
          value={state}
          onChange={(event) => setParams(event.target.value ? { state: event.target.value } : {})}
          className="rounded-md border border-ink-muted/40 bg-white px-3 py-2"
        >
          <option value="PENDING">Awaiting review</option>
          <option value="CHANGES_REQUESTED">Changes requested</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="DRAFT">Drafts</option>
          <option value="">All packages</option>
        </select>
      </div>

      {list.isPending ? (
        <p role="status" className="text-ink-muted">
          Loading…
        </p>
      ) : list.isError ? (
        <FormMessage kind="error">Couldn’t load packages.</FormMessage>
      ) : list.data.items.length === 0 ? (
        <p className="rounded-xl border border-cream-dark bg-white p-6 text-center text-ink-muted">
          No packages match this filter.
        </p>
      ) : (
        <>
          <div
            role="region"
            aria-label="Packages"
            tabIndex={0}
            className="overflow-x-auto rounded-xl border border-cream-dark bg-white"
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-cream-dark/60 text-ink-muted">
                <tr>
                  {["Package", "Business", "Review", "Updated"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id} className="border-t border-cream-dark">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/packages/${item.id}`}
                        className="font-medium text-terracotta underline"
                      >
                        {item.name || "Untitled package"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{item.businessName}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.reviewState} />
                      {item.status !== "ACTIVE" ? (
                        <div className="mt-1 text-xs text-ink-muted">
                          {item.status.toLowerCase()}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{dateFormat.format(new Date(item.updatedAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between">
              <SecondaryButton
                type="button"
                disabled={page <= 1}
                onClick={() => setParams({ state, page: String(page - 1) })}
              >
                Previous
              </SecondaryButton>
              <span className="text-sm text-ink-muted">
                Page {page} of {totalPages}
              </span>
              <SecondaryButton
                type="button"
                disabled={page >= totalPages}
                onClick={() => setParams({ state, page: String(page + 1) })}
              >
                Next
              </SecondaryButton>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function PackageContent({ view, heading }: { view: PackageView; heading: string }) {
  return (
    <section aria-label={heading} className="rounded-xl border border-cream-dark bg-white p-5">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="font-medium">Name</dt>
          <dd className="text-ink-muted">{view.name}</dd>
        </div>
        <div>
          <dt className="font-medium">Description</dt>
          <dd className="whitespace-pre-line text-ink-muted">{view.description}</dd>
        </div>
        <div>
          <dt className="font-medium">Includes</dt>
          <dd>
            <ul className="list-inside list-disc text-ink-muted">
              {view.includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-medium">Starting price</dt>
          <dd className="text-ink-muted">
            {view.startingPriceKes ? `KSh ${kes.format(view.startingPriceKes)}` : "Not shown"}
          </dd>
        </div>
      </dl>
      {view.image ? (
        <div className="mt-4 w-48">
          <Photo image={view.image} alt={`${view.name} photo`} sizes="200px" />
        </div>
      ) : null}
    </section>
  );
}

export function PackageReviewPage() {
  const { id = "" } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "package", id],
    queryFn: () => api.get<AdminPackageDetail>(`/api/admin/packages/${id}`),
  });

  if (detail.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        Loading…
      </p>
    );
  }
  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="space-y-3">
        <FormMessage kind="error">
          {missing ? "This package doesn’t exist." : "Couldn’t load this package."}
        </FormMessage>
        <Link to="/admin/packages" className="font-medium text-terracotta underline">
          Back to packages
        </Link>
      </div>
    );
  }

  const { package: pkg, business, draft, published, decisions } = detail.data;
  const awaiting = pkg.reviewState === "PENDING" && pkg.status === "ACTIVE";

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/packages" className="text-sm font-medium text-terracotta underline">
          ← All packages
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{draft.name}</h2>
          <StatusBadge status={pkg.reviewState} />
          {pkg.status !== "ACTIVE" ? <StatusBadge status={pkg.status as "SUSPENDED"} /> : null}
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          By {business.name} · business is {business.status.toLowerCase()}
        </p>
      </div>

      <ReviewDecisionPanel
        awaitingReview={awaiting}
        canSuspend={pkg.status === "ACTIVE" && pkg.publishedAt !== null}
        canReinstate={pkg.status === "SUSPENDED"}
        suspendLabel="Suspend package"
        reinstateLabel="Reinstate package"
        approveHint={
          published
            ? "This is an edit to a live package. The current version stays public until you approve it."
            : "Approving shows this package on the business’s public profile."
        }
        onDecide={async (decision) => {
          const fresh = await api.post<AdminPackageDetail>(
            `/api/admin/packages/${id}/decision`,
            decision,
          );
          queryClient.setQueryData(["admin", "package", id], fresh);
          await queryClient.invalidateQueries({ queryKey: ["admin", "packages"] });
        }}
      />

      <PackageContent view={draft} heading={awaiting ? "Submission to review" : "Latest draft"} />
      {published ? <PackageContent view={published} heading="Currently live" /> : null}

      <section
        aria-label="Decision history"
        className="rounded-xl border border-cream-dark bg-white p-5"
      >
        <h2 className="text-lg font-semibold">Decision history</h2>
        {decisions.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No decisions yet.</p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm">
            {decisions.map((d) => (
              <li key={d.id}>
                <span className="font-medium">{d.action.replace("_", " ").toLowerCase()}</span>
                <span className="text-ink-muted">
                  {" "}
                  · {d.admin.fullName ?? d.admin.email} · {dateTime.format(new Date(d.createdAt))}
                </span>
                {d.reason ? <p className="text-ink-muted">{d.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
