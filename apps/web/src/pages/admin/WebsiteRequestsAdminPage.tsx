import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  WEBSITE_REQUEST_BUDGET_LABELS,
  WEBSITE_REQUEST_STATUSES,
  WEBSITE_REQUEST_TIMELINE_LABELS,
  WEBSITE_REQUEST_TRANSITIONS,
  WEBSITE_REQUEST_TYPE_LABELS,
  buildWhatsAppLink,
  type WebsiteRequestStatus,
  type WebsiteRequestType,
} from "@kreatespace/shared";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { FormMessage, PrimaryButton, TextAreaField } from "../../components/forms";
import { statusLabel, StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { useApi } from "../../lib/queries";

interface AdminRequest {
  id: string;
  type: WebsiteRequestType;
  description: string;
  budget: string | null;
  timeline: string | null;
  status: WebsiteRequestStatus;
  responseNote: string | null;
  adminNotes: string | null;
  createdAt: string;
  business: {
    id: string;
    slug: string;
    name: string;
    ownerName: string;
    whatsappNumber: string;
    websiteUrl: string | null;
    ownerEmail: string;
  };
}

interface Page {
  requests: AdminRequest[];
  total: number;
  pageSize: number;
}

const dateTime = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" });
const message = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function RequestCard({ request, onChanged }: { request: AdminRequest; onChanged: () => void }) {
  const api = useApi();
  const [status, setStatus] = useState<string>(request.status);
  const [responseNote, setResponseNote] = useState(request.responseNote ?? "");
  const [adminNotes, setAdminNotes] = useState(request.adminNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const next = WEBSITE_REQUEST_TRANSITIONS[request.status];
  const contact = buildWhatsAppLink(
    request.business.whatsappNumber,
    `Hello ${request.business.ownerName}, this is KreateSpace about your website request.`,
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await api.patch(`/api/admin/website-requests/${request.id}`, {
        ...(status !== request.status ? { status } : {}),
        responseNote,
        adminNotes,
      });
      setSaved(true);
      onChanged();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-sand bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{request.business.name}</h3>
          <p className="text-sm text-ink-muted">
            {WEBSITE_REQUEST_TYPE_LABELS[request.type]} ·{" "}
            {dateTime.format(new Date(request.createdAt))}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <p className="mt-3 whitespace-pre-line text-sm">{request.description}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">Budget</dt>
          <dd className="text-ink-muted">
            {request.budget
              ? (WEBSITE_REQUEST_BUDGET_LABELS[
                  request.budget as keyof typeof WEBSITE_REQUEST_BUDGET_LABELS
                ] ?? request.budget)
              : "Not given"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Timeline</dt>
          <dd className="text-ink-muted">
            {request.timeline
              ? (WEBSITE_REQUEST_TIMELINE_LABELS[
                  request.timeline as keyof typeof WEBSITE_REQUEST_TIMELINE_LABELS
                ] ?? request.timeline)
              : "Not given"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Contact</dt>
          <dd className="text-ink-muted">
            {request.business.ownerName} · {request.business.ownerEmail}
            {contact ? (
              <>
                {" · "}
                <a
                  href={contact}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-terracotta underline"
                >
                  WhatsApp
                </a>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Business</dt>
          <dd>
            <Link to={`/businesses/${request.business.slug}`} className="text-terracotta underline">
              View profile
            </Link>
            {request.business.websiteUrl ? (
              <>
                {" · "}
                <a
                  href={request.business.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-terracotta underline"
                >
                  Current website
                </a>
              </>
            ) : null}
          </dd>
        </div>
      </dl>

      <form
        onSubmit={save}
        className="mt-4 space-y-3 border-t border-sand pt-4"
        aria-label={`Handle request from ${request.business.name}`}
      >
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        {saved ? <FormMessage kind="success">Saved.</FormMessage> : null}
        {next.length > 0 ? (
          <div>
            <label htmlFor={`status-${request.id}`} className="block text-sm font-medium">
              Status
            </label>
            <select
              id={`status-${request.id}`}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="mt-1 block w-full rounded-md border border-ink-muted/40 bg-white px-3 py-2 sm:w-auto"
            >
              <option value={request.status}>{statusLabel(request.status)} (current)</option>
              {next.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">This request is closed.</p>
        )}
        <TextAreaField
          label="Reply to the seller"
          optional
          rows={3}
          hint="Shown to the seller on their dashboard."
          value={responseNote}
          onChange={(event) => setResponseNote(event.target.value)}
        />
        <TextAreaField
          label="Private notes"
          optional
          rows={2}
          hint="Only administrators can see these."
          value={adminNotes}
          onChange={(event) => setAdminNotes(event.target.value)}
        />
        <PrimaryButton type="submit" disabled={busy} className="w-auto">
          {busy ? "Saving…" : "Save"}
        </PrimaryButton>
      </form>
    </li>
  );
}

/** Website requests from sellers, oldest first, with the controls to answer them. */
export function WebsiteRequestsAdminPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "NEW";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const key = ["admin", "website-requests", { status, page }] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<Page>(
        `/api/admin/website-requests?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page) })}`,
      ),
  });
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold tracking-tight">Website requests</h2>
      <div>
        <label htmlFor="request-status" className="sr-only">
          Filter requests by status
        </label>
        <select
          id="request-status"
          value={status}
          onChange={(event) => setParams(event.target.value ? { status: event.target.value } : {})}
          className="rounded-md border border-ink-muted/40 bg-white px-3 py-2"
        >
          {WEBSITE_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
          <option value="">All requests</option>
        </select>
      </div>

      {list.isPending ? (
        <p role="status" className="text-ink-muted">
          Loading…
        </p>
      ) : list.isError ? (
        <FormMessage kind="error">Couldn’t load website requests. Please try again.</FormMessage>
      ) : list.data.requests.length === 0 ? (
        <p className="rounded-xl border border-cream-dark bg-white p-6 text-center text-ink-muted">
          No requests match this filter.
        </p>
      ) : (
        <>
          <ul className="space-y-4" aria-label="Website requests">
            {list.data.requests.map((request) => (
              <RequestCard
                key={`${request.id}-${request.status}`}
                request={request}
                onChanged={() =>
                  void queryClient.invalidateQueries({ queryKey: ["admin", "website-requests"] })
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
