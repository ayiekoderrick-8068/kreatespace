import { REASON_MIN_LENGTH, reviewDecisionSchema, type ReviewCommand } from "@kreatespace/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { FormMessage, PrimaryButton, SecondaryButton, TextAreaField } from "../../components/forms";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { queryKeys, useApi } from "../../lib/queries";
import type { AdminBusinessDetail, RevisionView } from "../../lib/types";

const dateTimeFormat = new Intl.DateTimeFormat("en-KE", {
  dateStyle: "medium",
  timeStyle: "short",
});

const ACTION_LABELS: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  REINSTATED: "Reinstated",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-ink-muted">{children}</dd>
    </div>
  );
}

function RevisionDetails({ revision, heading }: { revision: RevisionView; heading: string }) {
  return (
    <section aria-label={heading} className="rounded-xl border border-cream-dark bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <StatusBadge status={revision.status} />
        <span className="text-sm text-ink-muted">Version {revision.version}</span>
      </div>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <Field label="Business name">{revision.businessName}</Field>
        <Field label="Owner">{revision.ownerName}</Field>
        <Field label="Category">{revision.category.name}</Field>
        <Field label="Location">
          {revision.city}, {revision.county}
        </Field>
        <Field label="WhatsApp">{revision.whatsappNumber}</Field>
        <Field label="Website">
          {revision.websiteUrl ? (
            <a
              href={revision.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terracotta underline"
            >
              {revision.websiteUrl}
            </a>
          ) : (
            "No website"
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">{revision.description}</Field>
        </div>
        <Field label="Seller terms accepted">{revision.termsAccepted ? "Yes" : "No"}</Field>
        <Field label="Content authorisation confirmed">
          {revision.contentAuthorized ? "Yes" : "No"}
        </Field>
        <Field label="Submitted">
          {revision.submittedAt
            ? dateTimeFormat.format(new Date(revision.submittedAt))
            : "Not submitted"}
        </Field>
      </dl>

      <h3 className="mt-5 text-sm font-medium">Logo</h3>
      {revision.logoUrl ? (
        <img
          src={revision.logoUrl}
          alt="Business logo"
          className="mt-2 h-16 w-16 rounded object-cover"
        />
      ) : (
        <p className="mt-1 text-sm text-ink-muted">No logo</p>
      )}

      <h3 className="mt-5 text-sm font-medium">Portfolio photos ({revision.images.length})</h3>
      {revision.images.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">No photos</p>
      ) : (
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {revision.images.map((image, index) => (
            <li key={image.path}>
              {image.url ? (
                <img
                  src={image.url}
                  alt={`Portfolio photo ${index + 1}`}
                  className="aspect-square w-full rounded object-cover"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded bg-cream-dark text-sm text-ink-muted">
                  Unavailable
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DecisionPanel({ detail }: { detail: AdminBusinessDetail }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ReviewCommand | null>(null);

  const { business, reviewRevision } = detail;
  const awaitingReview = reviewRevision.status === "PENDING";
  const canSuspend = business.status === "APPROVED";
  const canReinstate = business.status === "SUSPENDED";

  const decide = useMutation({
    mutationFn: (action: ReviewCommand) =>
      api.post<AdminBusinessDetail>(`/api/admin/businesses/${business.id}/decision`, {
        action,
        reason: reason.trim() || undefined,
        revisionId: awaitingReview ? reviewRevision.id : undefined,
      }),
    onSuccess: async (fresh) => {
      queryClient.setQueryData(queryKeys.adminBusiness(business.id), fresh);
      await queryClient.invalidateQueries({ queryKey: ["admin", "businesses"] });
      setReason("");
      setPendingAction(null);
    },
  });

  function run(action: ReviewCommand) {
    const parsed = reviewDecisionSchema.safeParse({ action, reason: reason.trim() || undefined });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Check your decision");
      return;
    }
    setFieldError(null);
    setPendingAction(action);
    decide.mutate(action);
  }

  if (!awaitingReview && !canSuspend && !canReinstate) {
    return (
      <section className="rounded-xl border border-cream-dark bg-white p-5">
        <h2 className="text-lg font-semibold">Decision</h2>
        <p className="mt-2 text-sm text-ink-muted">
          There’s nothing to review right now. This business has no submission awaiting a decision.
        </p>
      </section>
    );
  }

  const error = decide.error instanceof ApiError ? decide.error.message : null;
  const busy = decide.isPending;

  return (
    <section aria-label="Decision" className="rounded-xl border border-cream-dark bg-white p-5">
      <h2 className="text-lg font-semibold">Decision</h2>
      {awaitingReview ? (
        <p className="mt-1 text-sm text-ink-muted">
          {business.status === "APPROVED"
            ? "This is an update to a live profile. The current profile stays public until you approve it."
            : "Approving publishes this business on KreateSpace."}
        </p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
      <div className="mt-4">
        <TextAreaField
          label="Reason or feedback"
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint={`Required (at least ${REASON_MIN_LENGTH} characters) to request changes, reject or suspend. Sellers can see this message.`}
          error={fieldError ?? undefined}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {awaitingReview ? (
          <>
            <PrimaryButton
              type="button"
              className="w-auto"
              disabled={busy}
              onClick={() => run("APPROVE")}
            >
              {busy && pendingAction === "APPROVE" ? "Approving…" : "Approve"}
            </PrimaryButton>
            <SecondaryButton type="button" disabled={busy} onClick={() => run("REQUEST_CHANGES")}>
              Request changes
            </SecondaryButton>
            <SecondaryButton
              type="button"
              disabled={busy}
              onClick={() => run("REJECT")}
              className="text-red-800"
            >
              Reject
            </SecondaryButton>
          </>
        ) : null}
        {canSuspend ? (
          <SecondaryButton
            type="button"
            disabled={busy}
            onClick={() => run("SUSPEND")}
            className="text-red-800"
          >
            Suspend business
          </SecondaryButton>
        ) : null}
        {canReinstate ? (
          <PrimaryButton
            type="button"
            className="w-auto"
            disabled={busy}
            onClick={() => run("REINSTATE")}
          >
            Reinstate business
          </PrimaryButton>
        ) : null}
      </div>
    </section>
  );
}

export function BusinessReviewPage() {
  const { id = "" } = useParams();
  const api = useApi();

  const detail = useQuery({
    queryKey: queryKeys.adminBusiness(id),
    queryFn: () => api.get<AdminBusinessDetail>(`/api/admin/businesses/${id}`),
  });

  if (detail.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        Loading…
      </p>
    );
  }
  if (detail.isError) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className="space-y-3">
        <FormMessage kind="error">
          {notFound ? "This business doesn’t exist." : "Couldn’t load this application."}
        </FormMessage>
        <Link to="/admin/businesses" className="font-medium text-terracotta underline">
          Back to businesses
        </Link>
      </div>
    );
  }

  const data = detail.data;
  const { business, reviewRevision, publishedRevision } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/businesses" className="text-sm font-medium text-terracotta underline">
          ← All businesses
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{reviewRevision.businessName}</h2>
          <StatusBadge status={business.status} />
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Owner account: {business.owner.fullName ?? "—"} ({business.owner.email})
        </p>
      </div>

      <DecisionPanel detail={data} />

      <RevisionDetails
        revision={reviewRevision}
        heading={reviewRevision.status === "PENDING" ? "Submission to review" : "Latest version"}
      />
      {publishedRevision ? (
        <RevisionDetails revision={publishedRevision} heading="Currently live" />
      ) : null}

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
                  {dateTimeFormat.format(new Date(decision.createdAt))}
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
