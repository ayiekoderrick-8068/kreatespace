import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DELETION_STATUSES, type DeletionStatus } from "@kreatespace/shared";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { FormMessage, PrimaryButton, SecondaryButton, TextAreaField } from "../../components/forms";
import { ApiError } from "../../lib/api";
import type { DeletionEffects, DeletionRequestView } from "../../lib/account";
import { useApi } from "../../lib/queries";

interface AdminDeletion extends DeletionRequestView {
  roleAtRequest: "CUSTOMER" | "SELLER" | "ADMIN";
  reviewedAt: string | null;
  cancelledAt: string | null;
  reviewedBy: string | null;
  /** Live numbers while the account exists; null once it has gone or cannot be read. */
  effects: DeletionEffects | null;
  /** Counts of what was deleted, kept after completion. */
  summary: Record<string, number | boolean> | null;
  requester: string | null;
  history: { action: string; at: string }[];
}

interface Page {
  items: AdminDeletion[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_LABELS: Record<DeletionStatus, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  REJECTED: "Refused",
  CANCELLED: "Withdrawn",
  COMPLETED: "Completed",
};
const STATUS_STYLES: Record<DeletionStatus, string> = {
  REQUESTED: "bg-amber-100 text-amber-900",
  APPROVED: "bg-sky-100 text-sky-900",
  REJECTED: "bg-red-100 text-red-900",
  CANCELLED: "bg-cream-dark text-ink-muted",
  COMPLETED: "bg-green-100 text-green-900",
};
const ACTION_LABELS: Record<string, string> = {
  "account.deletion_requested": "Requested by the account holder",
  "account.deletion_approved": "Approved by an administrator",
  "account.deletion_rejected": "Refused by an administrator",
  "account.deletion_cancelled": "Withdrawn by the account holder",
  "account.deleted": "Account and records deleted",
};
const SUMMARY_LABELS: Record<string, string> = {
  savedCreations: "Saved creations",
  creations: "Creations",
  packages: "Service packages",
  websiteRequests: "Website requests",
  filesRemoved: "Photos removed",
};

const dateTime = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" });
const date = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" });
const errorText = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function Dependencies({ effects }: { effects: DeletionEffects }) {
  const business = effects.business;
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="font-medium">Saved creations</dt>
        <dd className="text-ink-muted">{effects.savedCreations}</dd>
      </div>
      {business ? (
        <>
          <div>
            <dt className="font-medium">Business</dt>
            <dd className="text-ink-muted">
              {business.name ?? "Unnamed"} · {business.status.toLowerCase()}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Creations (all statuses)</dt>
            <dd className="text-ink-muted">{business.creations}</dd>
          </div>
          <div>
            <dt className="font-medium">Service packages</dt>
            <dd className="text-ink-muted">{business.packages}</dd>
          </div>
          <div>
            <dt className="font-medium">Open website requests</dt>
            <dd className="text-ink-muted">{business.openWebsiteRequests}</dd>
          </div>
          <div>
            <dt className="font-medium">Website import</dt>
            <dd className="text-ink-muted">
              {business.importInProgress ? "Running; deletion waits for it" : "None running"}
            </dd>
          </div>
        </>
      ) : (
        <div>
          <dt className="font-medium">Business</dt>
          <dd className="text-ink-muted">None</dd>
        </div>
      )}
    </dl>
  );
}

function Decision({ item, onDone }: { item: AdminDeletion; onDone: () => void }) {
  const api = useApi();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "APPROVE" | "REJECT", event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/admin/deletions/${item.id}/decision`, {
        action,
        ...(action === "REJECT" ? { note: note.trim() } : {}),
      });
      onDone();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const waitFor = item.effects?.business?.importInProgress;
  return (
    <div className="mt-4 border-t border-sand pt-4">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-3">
          <PrimaryButton type="button" className="w-auto" onClick={() => setMode("approve")}>
            Approve deletion…
          </PrimaryButton>
          <SecondaryButton type="button" onClick={() => setMode("reject")}>
            Refuse…
          </SecondaryButton>
        </div>
      ) : null}
      {mode === "approve" ? (
        <div role="group" aria-label="Confirm approval" className="space-y-3">
          <p className="text-sm">
            Approving does not delete anything now. The account and the business are permanently
            deleted by the daily clean-up on or after{" "}
            <strong>{date.format(new Date(item.scheduledFor))}</strong>
            {waitFor ? ", once the running import has finished" : ""}. The person can still cancel
            until then.
          </p>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton
              type="button"
              className="w-auto"
              disabled={busy}
              onClick={() => void send("APPROVE")}
            >
              {busy ? "Approving…" : "Confirm approval"}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={() => setMode("idle")} disabled={busy}>
              Back
            </SecondaryButton>
          </div>
        </div>
      ) : null}
      {mode === "reject" ? (
        <form onSubmit={(event) => void send("REJECT", event)} className="space-y-3">
          <TextAreaField
            label="Reason shown to the person"
            required
            rows={3}
            maxLength={500}
            hint="They will read this on their account page."
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <PrimaryButton type="submit" className="w-auto" disabled={busy || !note.trim()}>
              {busy ? "Sending…" : "Refuse request"}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={() => setMode("idle")} disabled={busy}>
              Back
            </SecondaryButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function DeletionCard({ item, onChanged }: { item: AdminDeletion; onChanged: () => void }) {
  const actionable = item.status === "REQUESTED" && item.needsReview;
  return (
    <li className="rounded-xl border border-sand bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{item.requester ?? "Account no longer exists"}</h3>
          <p className="text-sm text-ink-muted">
            {item.roleAtRequest === "SELLER" ? "Business owner" : "Customer"} · asked{" "}
            {dateTime.format(new Date(item.requestedAt))}
          </p>
        </div>
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[item.status]}`}
        >
          {STATUS_LABELS[item.status]}
        </span>
      </div>

      <p className="mt-3 text-sm">
        {item.status === "REQUESTED" && item.needsReview
          ? "Needs your decision. Nothing happens until you approve."
          : item.status === "REQUESTED"
            ? `No review needed: carried out automatically on or after ${date.format(new Date(item.scheduledFor))}.`
            : item.status === "APPROVED"
              ? `Approved. Carried out on or after ${date.format(new Date(item.scheduledFor))}.`
              : item.status === "COMPLETED"
                ? `Completed ${item.completedAt ? dateTime.format(new Date(item.completedAt)) : ""}.`
                : item.status === "REJECTED"
                  ? "Refused. The person was shown the reason."
                  : "Withdrawn by the account holder."}
      </p>

      {item.effects ? (
        <div className="mt-3">
          <p className="mb-1 text-sm font-medium">What deleting would remove</p>
          <Dependencies effects={item.effects} />
        </div>
      ) : null}

      {item.summary ? (
        <div className="mt-3">
          <p className="mb-1 text-sm font-medium">What was deleted</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
            {Object.entries(item.summary)
              .filter(([key]) => key in SUMMARY_LABELS)
              .map(([key, value]) => (
                <li key={key}>
                  {SUMMARY_LABELS[key]}: {String(value)}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {item.reviewNote ? (
        <p className="mt-3 text-sm">
          <span className="font-medium">Reason given:</span> {item.reviewNote}
        </p>
      ) : null}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">History</summary>
        <ol className="mt-2 space-y-1 text-ink-muted">
          {item.history.map((entry) => (
            <li key={`${entry.action}-${entry.at}`}>
              {dateTime.format(new Date(entry.at))} · {ACTION_LABELS[entry.action] ?? entry.action}
              {entry.action.endsWith("approved") || entry.action.endsWith("rejected")
                ? item.reviewedBy
                  ? ` (${item.reviewedBy})`
                  : ""
                : ""}
            </li>
          ))}
        </ol>
      </details>

      {actionable ? <Decision item={item} onDone={onChanged} /> : null}
    </li>
  );
}

/** Account-deletion requests. Business owners' requests wait here for an administrator's decision. */
export function DeletionsAdminPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const list = useQuery({
    queryKey: ["admin", "deletions", { status, page }],
    queryFn: () =>
      api.get<Page>(
        `/api/admin/deletions?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page) })}`,
      ),
  });
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold tracking-tight">Account deletions</h2>
      <div>
        <label htmlFor="deletion-status" className="sr-only">
          Filter requests by status
        </label>
        <select
          id="deletion-status"
          value={status}
          onChange={(event) => setParams(event.target.value ? { status: event.target.value } : {})}
          className="rounded-md border border-ink-muted/40 bg-white px-3 py-2"
        >
          <option value="">Open requests</option>
          {DELETION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {list.isPending ? (
        <p role="status" className="text-ink-muted">
          Loading…
        </p>
      ) : list.isError ? (
        <FormMessage kind="error">Couldn’t load deletion requests. Please try again.</FormMessage>
      ) : list.data.items.length === 0 ? (
        <p className="rounded-xl border border-cream-dark bg-white p-6 text-center text-ink-muted">
          No requests match this filter.
        </p>
      ) : (
        <>
          <ul className="space-y-4" aria-label="Account deletion requests">
            {list.data.items.map((item) => (
              <DeletionCard
                key={`${item.id}-${item.status}`}
                item={item}
                onChanged={() =>
                  void queryClient.invalidateQueries({ queryKey: ["admin", "deletions"] })
                }
              />
            ))}
          </ul>
          {totalPages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setParams({ ...(status ? { status } : {}), page: String(page - 1) })}
                className="font-medium text-terracotta underline disabled:opacity-40"
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setParams({ ...(status ? { status } : {}), page: String(page + 1) })}
                className="font-medium text-terracotta underline disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
