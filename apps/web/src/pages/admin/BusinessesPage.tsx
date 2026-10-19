import { BUSINESS_STATUSES } from "@kreatespace/shared";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { FormMessage, PrimaryButton, SecondaryButton } from "../../components/forms";
import { StatusBadge, statusLabel } from "../../components/StatusBadge";
import { queryKeys, useApi } from "../../lib/queries";
import type { AdminBusinessList } from "../../lib/types";

const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" });

export function BusinessesPage() {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const [search, setSearch] = useState(q);

  const query = { status, q, page };
  const list = useQuery({
    queryKey: queryKeys.adminBusinesses(query),
    queryFn: () => {
      const search = new URLSearchParams();
      if (status) search.set("status", status);
      if (q) search.set("q", q);
      search.set("page", String(page));
      return api.get<AdminBusinessList>(`/api/admin/businesses?${search.toString()}`);
    },
  });

  function update(next: Partial<Record<"status" | "q" | "page", string>>) {
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <form onSubmit={onSearch} role="search" className="flex flex-1 gap-2 sm:max-w-md">
          <div className="flex-1">
            <label htmlFor="business-search" className="sr-only">
              Search applications
            </label>
            <input
              id="business-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by business, owner, email or place"
              className="block w-full rounded-md border border-ink-muted/40 bg-white px-3 py-2"
            />
          </div>
          <PrimaryButton type="submit" className="w-auto">
            Search
          </PrimaryButton>
        </form>
        <div>
          <label htmlFor="status-filter" className="sr-only">
            Filter by status
          </label>
          <select
            id="status-filter"
            value={status}
            onChange={(event) => update({ status: event.target.value, page: "" })}
            className="rounded-md border border-ink-muted/40 bg-white px-3 py-2"
          >
            <option value="">All statuses</option>
            {BUSINESS_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value === "PENDING" ? "Awaiting review" : statusLabel(value)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.isPending ? (
        <p role="status" className="text-ink-muted">
          Loading…
        </p>
      ) : list.isError ? (
        <FormMessage kind="error">Couldn’t load applications.</FormMessage>
      ) : list.data.items.length === 0 ? (
        <p className="rounded-xl border border-cream-dark bg-white p-6 text-center text-ink-muted">
          No applications match these filters.
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {list.data.total} {list.data.total === 1 ? "business" : "businesses"}
          </p>
          <div
            role="region"
            aria-label="Businesses"
            tabIndex={0}
            className="overflow-x-auto rounded-xl border border-cream-dark bg-white"
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-cream-dark/60 text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Business
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Owner
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Location
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id} className="border-t border-cream-dark align-top">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/businesses/${item.id}`}
                        className="font-medium text-terracotta underline"
                      >
                        {item.businessName}
                      </Link>
                      <div className="text-ink-muted">{item.categoryName}</div>
                    </td>
                    <td className="px-4 py-3">
                      {item.ownerName}
                      <div className="text-ink-muted">{item.ownerEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      {item.city}, {item.county}
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
