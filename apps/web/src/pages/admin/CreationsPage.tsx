import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { FormMessage, PrimaryButton, SecondaryButton } from "../../components/forms";
import { StatusBadge, statusLabel } from "../../components/StatusBadge";
import { useApi, useFilterOptions } from "../../lib/queries";
import type { AdminCreationListItem, CreationStatus } from "../../lib/types";

const STATUSES: CreationStatus[] = [
  "PENDING",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "ARCHIVED",
  "DRAFT",
];

const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" });

interface List {
  items: AdminCreationListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export function CreationsPage() {
  const api = useApi();
  const options = useFilterOptions();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const category = params.get("category") ?? "";
  const businessId = params.get("businessId") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const [search, setSearch] = useState(q);

  const list = useQuery({
    queryKey: ["admin", "creations", { status, category, businessId, q, page }],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page) });
      if (status) query.set("status", status);
      if (category) query.set("category", category);
      if (businessId) query.set("businessId", businessId);
      if (q) query.set("q", q);
      return api.get<List>(`/api/admin/creations?${query.toString()}`);
    },
  });

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    setParams(merged);
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    update({ q: search.trim(), page: "" });
  }

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const select = "rounded-md border border-ink-muted/40 bg-white px-3 py-2";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <form onSubmit={onSearch} role="search" className="flex flex-1 gap-2 sm:max-w-md">
          <div className="flex-1">
            <label htmlFor="creation-search" className="sr-only">
              Search submissions
            </label>
            <input
              id="creation-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, description or business"
              className="block w-full rounded-md border border-ink-muted/40 bg-white px-3 py-2"
            />
          </div>
          <PrimaryButton type="submit" className="w-auto">
            Search
          </PrimaryButton>
        </form>
        <div>
          <label htmlFor="creation-status" className="sr-only">
            Filter by status
          </label>
          <select
            id="creation-status"
            value={status}
            onChange={(event) => update({ status: event.target.value, page: "" })}
            className={select}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value === "PENDING" ? "Awaiting review" : statusLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="creation-category" className="sr-only">
            Filter by category
          </label>
          <select
            id="creation-category"
            value={category}
            onChange={(event) => update({ category: event.target.value, page: "" })}
            className={select}
          >
            <option value="">All categories</option>
            {(options.data?.categories ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {businessId ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          Showing one business’s creations.
          <button
            type="button"
            onClick={() => update({ businessId: "", page: "" })}
            className="font-medium text-terracotta underline"
          >
            Show all businesses
          </button>
        </p>
      ) : null}

      {list.isPending ? (
        <p role="status" className="text-ink-muted">
          Loading…
        </p>
      ) : list.isError ? (
        <FormMessage kind="error">Couldn’t load creations.</FormMessage>
      ) : list.data.items.length === 0 ? (
        <p className="rounded-xl border border-cream-dark bg-white p-6 text-center text-ink-muted">
          No creations match these filters.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {list.data.total} {list.data.total === 1 ? "creation" : "creations"}
          </p>
          <div
            role="region"
            aria-label="Creations"
            tabIndex={0}
            className="overflow-x-auto rounded-xl border border-cream-dark bg-white"
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-cream-dark/60 text-ink-muted">
                <tr>
                  {["Creation", "Business", "Status", "Updated"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id} className="border-t border-cream-dark align-top">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/creations/${item.id}`}
                        className="font-medium text-terracotta underline"
                      >
                        {item.title}
                      </Link>
                      <div className="text-ink-muted">{item.categoryName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => update({ businessId: item.businessId, page: "" })}
                        className="text-left hover:underline"
                        title="Show only this business"
                      >
                        {item.businessName}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} />
                      {item.hasPendingSubmission && item.status !== "PENDING" ? (
                        <div className="mt-1 text-xs font-medium text-amber-800">
                          Update awaiting review
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
                onClick={() => update({ page: String(page - 1) })}
              >
                Previous
              </SecondaryButton>
              <span className="text-sm text-ink-muted">
                Page {page} of {totalPages}
              </span>
              <SecondaryButton
                type="button"
                disabled={page >= totalPages}
                onClick={() => update({ page: String(page + 1) })}
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
