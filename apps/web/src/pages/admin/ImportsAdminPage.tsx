import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  CheckboxField,
  FormMessage,
  PrimaryButton,
  SecondaryButton,
  SelectField,
} from "../../components/forms";
import { StatusBadge } from "../../components/StatusBadge";
import { ApiError } from "../../lib/api";
import { useOccasions } from "../../lib/portfolio";
import { useApi, useCategories } from "../../lib/queries";
import type { AdminBusinessList } from "../../lib/types";

interface Authorization {
  id: string;
  businessId: string;
  businessName: string;
  domain: string;
  createdAt: string;
  revokedAt: string | null;
}

interface Job {
  id: string;
  businessName: string;
  domain: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  pagesFetched: number;
  itemsFound: number;
  duplicates: number;
  skipped: number;
  failure: string | null;
  createdAt: string;
}

interface Item {
  id: string;
  businessName: string;
  sourceUrl: string;
  title: string;
  description: string;
  imageUrls: string[];
  status: "PENDING_REVIEW" | "DUPLICATE" | "ACCEPTED" | "REJECTED";
  duplicateReason: string | null;
  creationId: string | null;
}

const dateTime = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" });
const message = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

const KEYS = {
  authorizations: ["admin", "imports", "authorizations"] as const,
  jobs: ["admin", "imports", "jobs"] as const,
  items: (status: string) => ["admin", "imports", "items", status] as const,
};

function useRefreshImports() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["admin", "imports"] });
}

// --- authorisations --------------------------------------------------------------------------------

function AuthorizationsSection({ onStarted }: { onStarted: (message: string) => void }) {
  const api = useApi();
  const refresh = useRefreshImports();
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const list = useQuery({
    queryKey: KEYS.authorizations,
    queryFn: () =>
      api.get<{ authorizations: Authorization[] }>("/api/admin/imports/authorizations"),
  });
  const businesses = useQuery({
    queryKey: ["admin", "imports", "approved-businesses"],
    queryFn: () => api.get<AdminBusinessList>("/api/admin/businesses?status=APPROVED"),
  });

  async function run(label: string, action: () => Promise<unknown>) {
    setError(null);
    setBusy(label);
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(null);
    }
  }

  const active = (list.data?.authorizations ?? []).filter((a) => !a.revokedAt);

  return (
    <section
      aria-labelledby="auth-heading"
      className="rounded-xl border border-cream-dark bg-white p-5"
    >
      <h3 id="auth-heading" className="text-lg font-semibold">
        Authorised websites
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        KreateSpace only reads a website its owner has authorised. The address comes from the
        business’s approved profile, and the business must have confirmed that it owns the content.
      </p>
      {error ? (
        <div className="mt-3">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}

      <form
        aria-label="Authorise a website"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!businessId) return;
          void run("grant", async () => {
            await api.post("/api/admin/imports/authorizations", { businessId });
            setBusinessId("");
          });
        }}
      >
        <div className="min-w-56 flex-1">
          <SelectField
            label="Business"
            placeholder="Choose a business"
            value={businessId}
            onChange={(event) => setBusinessId(event.target.value)}
            options={(businesses.data?.items ?? []).map((b) => ({
              value: b.id,
              label: b.businessName,
            }))}
          />
        </div>
        <PrimaryButton type="submit" className="w-auto" disabled={!businessId || busy === "grant"}>
          Authorise website
        </PrimaryButton>
      </form>

      {list.isPending ? (
        <p role="status" className="mt-4 text-sm text-ink-muted">
          Loading…
        </p>
      ) : list.isError ? (
        <div className="mt-4">
          <FormMessage kind="error">Couldn’t load authorised websites.</FormMessage>
        </div>
      ) : active.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No websites are authorised yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-cream-dark" aria-label="Authorised websites">
          {active.map((authorization) => (
            <li
              key={authorization.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="font-medium">{authorization.businessName}</p>
                <p className="text-sm text-ink-muted">{authorization.domain}</p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <SecondaryButton
                  type="button"
                  disabled={busy === `start-${authorization.id}`}
                  aria-label={`Start an import for ${authorization.businessName}`}
                  onClick={() =>
                    void run(`start-${authorization.id}`, async () => {
                      await api.post("/api/admin/imports/jobs", {
                        authorizationId: authorization.id,
                      });
                      onStarted(`Import started for ${authorization.domain}.`);
                    })
                  }
                >
                  Start import
                </SecondaryButton>
                {confirmRevoke === authorization.id ? (
                  <span className="flex gap-3">
                    <button
                      type="button"
                      className="font-medium text-red-700 underline"
                      onClick={() =>
                        void run("revoke", async () => {
                          await api.delete(`/api/admin/imports/authorizations/${authorization.id}`);
                          setConfirmRevoke(null);
                        })
                      }
                    >
                      Yes, revoke
                    </button>
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => setConfirmRevoke(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="font-medium text-red-700 underline"
                    aria-label={`Revoke ${authorization.domain}`}
                    onClick={() => setConfirmRevoke(authorization.id)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- jobs ------------------------------------------------------------------------------------------

function JobsSection({ notice }: { notice: string | null }) {
  const api = useApi();
  const jobs = useQuery({
    queryKey: KEYS.jobs,
    queryFn: () => api.get<{ jobs: Job[] }>("/api/admin/imports/jobs"),
    // Keep checking while a crawl is still running.
    refetchInterval: (query) =>
      query.state.data?.jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING")
        ? 3000
        : false,
  });

  return (
    <section
      aria-labelledby="jobs-heading"
      className="rounded-xl border border-cream-dark bg-white p-5"
    >
      <h3 id="jobs-heading" className="text-lg font-semibold">
        Imports
      </h3>
      {notice ? (
        <div className="mt-3">
          <FormMessage kind="success">{notice}</FormMessage>
        </div>
      ) : null}
      {jobs.isPending ? (
        <p role="status" className="mt-3 text-sm text-ink-muted">
          Loading…
        </p>
      ) : jobs.isError ? (
        <div className="mt-3">
          <FormMessage kind="error">Couldn’t load imports.</FormMessage>
        </div>
      ) : jobs.data.jobs.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No imports have been run yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="text-ink-muted">
                {["Website", "Status", "Pages read", "Found", "Duplicates", "Started"].map((h) => (
                  <th key={h} scope="col" className="py-2 pr-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.data.jobs.map((job) => (
                <tr key={job.id} className="border-t border-cream-dark align-top">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {job.businessName}
                    <span className="block text-xs text-ink-muted">{job.domain}</span>
                  </th>
                  <td className="py-2 pr-4">
                    <StatusBadge status={job.status} />
                    {job.failure ? (
                      <span className="mt-1 block text-xs text-red-800">{job.failure}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{job.pagesFetched}</td>
                  <td className="py-2 pr-4">{job.itemsFound}</td>
                  <td className="py-2 pr-4">{job.duplicates}</td>
                  <td className="py-2 pr-4">{dateTime.format(new Date(job.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// --- reviewing what was found ------------------------------------------------------------------------

function ItemCard({ item }: { item: Item }) {
  const api = useApi();
  const refresh = useRefreshImports();
  const categories = useCategories();
  const occasions = useOccasions();
  const [categoryId, setCategoryId] = useState("");
  const [occasionId, setOccasionId] = useState("");
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const open = item.status === "PENDING_REVIEW" || item.status === "DUPLICATE";

  async function accept() {
    setError(null);
    if (!categoryId) {
      setError("Choose a category first.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ imagesImported: number; imagesSkipped: number }>(
        `/api/admin/imports/items/${item.id}/accept`,
        {
          categoryId,
          occasionId: occasionId || null,
          ...(item.status === "DUPLICATE" ? { confirmDuplicate } : {}),
        },
      );
      setDone(
        `Draft created with ${result.imagesImported} ${result.imagesImported === 1 ? "photo" : "photos"}${
          result.imagesSkipped ? ` (${result.imagesSkipped} skipped)` : ""
        }. The seller can now review and submit it.`,
      );
      await refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/admin/imports/items/${item.id}/reject`);
      await refresh();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-sand bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-semibold">{item.title}</h4>
          <p className="text-sm text-ink-muted">{item.businessName}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <p className="mt-2 text-sm">{item.description}</p>
      <p className="mt-2 break-all text-xs text-ink-muted">
        From{" "}
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-terracotta underline"
        >
          {item.sourceUrl}
        </a>{" "}
        · {item.imageUrls.length} {item.imageUrls.length === 1 ? "photo" : "photos"} found
      </p>
      {item.duplicateReason ? (
        <p className="mt-2 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-900">
          Possible duplicate: {item.duplicateReason}
        </p>
      ) : null}

      {error ? (
        <div className="mt-3">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
      {done ? (
        <div className="mt-3">
          <FormMessage kind="success">{done}</FormMessage>
        </div>
      ) : null}

      {open && !done ? (
        <div className="mt-4 space-y-3 border-t border-sand pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label="Category"
              required
              placeholder="Choose a category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
            <SelectField
              label="Occasion"
              optional
              placeholder="No occasion"
              value={occasionId}
              onChange={(event) => setOccasionId(event.target.value)}
              options={(occasions.data ?? []).map((o) => ({ value: o.id, label: o.name }))}
            />
          </div>
          {item.status === "DUPLICATE" ? (
            <CheckboxField
              label="Import it anyway"
              checked={confirmDuplicate}
              onChange={(event) => setConfirmDuplicate(event.target.checked)}
            />
          ) : null}
          <p className="text-xs text-ink-muted">
            This creates a private draft. The seller still has to submit it, and our team approves
            it, before anyone can see it.
          </p>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton
              type="button"
              className="w-auto"
              disabled={busy}
              onClick={() => void accept()}
            >
              {busy ? "Working…" : "Import as draft"}
            </PrimaryButton>
            <SecondaryButton type="button" disabled={busy} onClick={() => void reject()}>
              Reject
            </SecondaryButton>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function ItemsSection() {
  const api = useApi();
  const [status, setStatus] = useState("PENDING_REVIEW");
  const items = useQuery({
    queryKey: KEYS.items(status),
    queryFn: () => api.get<{ items: Item[] }>(`/api/admin/imports/items?status=${status}`),
  });

  return (
    <section aria-labelledby="items-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="items-heading" className="text-lg font-semibold">
          Pages found
        </h3>
        <div>
          <label htmlFor="item-status" className="sr-only">
            Filter pages by status
          </label>
          <select
            id="item-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-md border border-ink-muted/40 bg-white px-3 py-2"
          >
            <option value="PENDING_REVIEW">Needs review</option>
            <option value="DUPLICATE">Possible duplicates</option>
            <option value="ACCEPTED">Imported</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </div>
      </div>
      {items.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading…
        </p>
      ) : items.isError ? (
        <FormMessage kind="error">Couldn’t load the pages that were found.</FormMessage>
      ) : items.data.items.length === 0 ? (
        <p className="rounded-xl border border-cream-dark bg-white p-6 text-center text-sm text-ink-muted">
          No pages in this list.
        </p>
      ) : (
        <ul className="space-y-4" aria-label="Pages found">
          {items.data.items.map((item) => (
            <ItemCard key={`${item.id}-${item.status}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Authorised website importing: who may be read, what a crawl found, and what to turn into drafts. */
export function ImportsAdminPage() {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold tracking-tight">Website imports</h2>
      <AuthorizationsSection onStarted={setNotice} />
      <JobsSection notice={notice} />
      <ItemsSection />
    </div>
  );
}
