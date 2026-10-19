import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { FormMessage } from "../../components/forms";
import { Photo } from "../../components/gallery";
import { ReviewDecisionPanel } from "../../components/ReviewDecisionPanel";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/queries";
import type { AdminCreationDetail, SellerRevision } from "../../lib/types";

const dateTime = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" });

const ACTION_LABELS: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  REINSTATED: "Reinstated",
};

function Version({ revision, heading }: { revision: SellerRevision; heading: string }) {
  return (
    <section aria-label={heading} className="rounded-xl border border-cream-dark bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <StatusBadge status={revision.status} />
        <span className="text-sm text-ink-muted">Version {revision.version}</span>
      </div>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">Title</dt>
          <dd className="mt-0.5 text-ink-muted">{revision.title}</dd>
        </div>
        <div>
          <dt className="font-medium">Category · Occasion</dt>
          <dd className="mt-0.5 text-ink-muted">
            {revision.category.name} · {revision.occasion?.name ?? "None"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium">Description</dt>
          <dd className="mt-0.5 whitespace-pre-line text-ink-muted">{revision.description}</dd>
        </div>
      </dl>
      <h3 className="mt-5 text-sm font-medium">Photos ({revision.images.length})</h3>
      {revision.images.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">No photos</p>
      ) : (
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {revision.images.map((image, index) => (
            <li key={image.id}>
              <Photo
                image={{ url: image.url, srcSet: null, width: image.width, height: image.height }}
                alt={`Photo ${index + 1}`}
                sizes="300px"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CreationReviewPage() {
  const { id = "" } = useParams();
  const api = useApi();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "creation", id],
    queryFn: () => api.get<AdminCreationDetail>(`/api/admin/creations/${id}`),
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
          {missing ? "This creation doesn’t exist." : "Couldn’t load this creation."}
        </FormMessage>
        <Link to="/admin/creations" className="font-medium text-terracotta underline">
          Back to creations
        </Link>
      </div>
    );
  }

  const data = detail.data;
  const { creation, business, reviewRevision, publishedRevision } = data;
  const awaiting = reviewRevision.status === "PENDING";

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/creations" className="text-sm font-medium text-terracotta underline">
          ← All creations
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{reviewRevision.title}</h2>
          <StatusBadge status={creation.status} />
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          By{" "}
          <Link to={`/admin/businesses`} className="underline">
            {business.name}
          </Link>{" "}
          · business is {business.status.toLowerCase()} ·{" "}
          <Link to={`/admin/creations?businessId=${business.id}`} className="underline">
            all of its creations
          </Link>
        </p>
      </div>

      <ReviewDecisionPanel
        awaitingReview={awaiting}
        canSuspend={creation.status === "APPROVED"}
        canReinstate={creation.status === "SUSPENDED"}
        suspendLabel="Suspend creation"
        reinstateLabel="Reinstate creation"
        approveHint={
          creation.status === "APPROVED"
            ? "This is an edit to a live creation. The current version stays public until you approve it."
            : "Approving publishes this creation in discovery."
        }
        onDecide={async (decision) => {
          const fresh = await api.post<AdminCreationDetail>(`/api/admin/creations/${id}/decision`, {
            ...decision,
            revisionId: awaiting ? reviewRevision.id : undefined,
          });
          queryClient.setQueryData(["admin", "creation", id], fresh);
          await queryClient.invalidateQueries({ queryKey: ["admin", "creations"] });
        }}
      />

      <Version
        revision={reviewRevision}
        heading={awaiting ? "Submission to review" : "Latest version"}
      />
      {publishedRevision ? <Version revision={publishedRevision} heading="Currently live" /> : null}

      <section
        aria-label="Decision history"
        className="rounded-xl border border-cream-dark bg-white p-5"
      >
        <h2 className="text-lg font-semibold">Decision history</h2>
        {data.decisions.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No decisions yet.</p>
        ) : (
          <ul className="mt-3 space-y-4 text-sm">
            {data.decisions.map((decision) => (
              <li key={decision.id}>
                <span className="font-medium">
                  {ACTION_LABELS[decision.action] ?? decision.action}
                </span>
                <span className="text-ink-muted">
                  {" "}
                  · {decision.admin.fullName ?? decision.admin.email} ·{" "}
                  {dateTime.format(new Date(decision.createdAt))}
                </span>
                {decision.reason ? (
                  <p className="mt-0.5 text-ink-muted">{decision.reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
