import { useState } from "react";
import { Link } from "react-router";
import { ActivityCharts, CLICK_NOTE, PeriodPicker, Tile } from "../../components/AnalyticsParts";
import { FormMessage, SecondaryButton } from "../../components/forms";
import { usePlatformAnalytics } from "../../lib/analytics";

const number = new Intl.NumberFormat("en-KE");

function QueueLink({ to, label, count }: { to: string; label: string; count: number }) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-cream-dark bg-white px-4 py-2 hover:bg-cream"
      >
        <span>{label}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${count > 0 ? "bg-amber-100 text-amber-900" : "bg-cream-dark text-ink-muted"}`}
        >
          {count}
        </span>
      </Link>
    </li>
  );
}

function Counts({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  return (
    <section className="rounded-xl border border-cream-dark bg-white p-4">
      <h3 className="font-medium">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">None yet.</p>
      ) : (
        <dl className="mt-2 space-y-1 text-sm">
          {entries.map(([status, count]) => (
            <div key={status} className="flex justify-between gap-3">
              <dt className="text-ink-muted">{status.replace("_", " ").toLowerCase()}</dt>
              <dd className="font-medium">{number.format(count)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** Platform-wide figures for administrators: what needs attention and how the site is used. */
export function AnalyticsAdminPage() {
  const [days, setDays] = useState(30);
  const analytics = usePlatformAnalytics(days);

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Platform analytics</h2>
      <div className="mt-3">
        <PeriodPicker days={days} onChange={setDays} />
      </div>

      {analytics.isPending ? (
        <p role="status" className="mt-6">
          Loading figures…
        </p>
      ) : analytics.isError ? (
        <div className="mt-6 space-y-3">
          <FormMessage kind="error">We couldn’t load the analytics. Please try again.</FormMessage>
          <SecondaryButton type="button" onClick={() => void analytics.refetch()}>
            Try again
          </SecondaryButton>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <section aria-labelledby="queues-heading">
            <h3 id="queues-heading" className="font-medium">
              Waiting for you
            </h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              <QueueLink
                to="/admin/businesses"
                label="Business applications"
                count={analytics.data.queues.businessesPending}
              />
              <QueueLink
                to="/admin/creations"
                label="Creations to review"
                count={analytics.data.queues.creationsPending}
              />
              <QueueLink
                to="/admin/packages"
                label="Packages to review"
                count={analytics.data.queues.packagesPending}
              />
              <QueueLink
                to="/admin/website-requests"
                label="New website requests"
                count={analytics.data.queues.websiteRequestsNew}
              />
            </ul>
          </section>

          <dl className="grid gap-3 sm:grid-cols-3" aria-label={`Totals for the last ${days} days`}>
            <Tile
              label="Page views"
              value={analytics.data.totals.creationViews + analytics.data.totals.businessViews}
            />
            <Tile label="WhatsApp link clicks" value={analytics.data.totals.whatsappClicks} />
            <Tile label="Website link clicks" value={analytics.data.totals.websiteClicks} />
          </dl>

          <ActivityCharts series={analytics.data.series} />
          <p className="text-sm text-ink-muted">{CLICK_NOTE}</p>

          <div className="grid gap-3 sm:grid-cols-3">
            <Counts title="Businesses" counts={analytics.data.businesses} />
            <Counts title="Creations" counts={analytics.data.creations} />
            <Counts title="Accounts" counts={analytics.data.users} />
          </div>

          <section
            aria-labelledby="top-businesses"
            className="rounded-xl border border-cream-dark bg-white p-4"
          >
            <h3 id="top-businesses" className="font-medium">
              Most active businesses
            </h3>
            {analytics.data.topBusinesses.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No activity recorded in this period.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr className="text-ink-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Business
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        Views
                      </th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">
                        WhatsApp
                      </th>
                      <th scope="col" className="py-2 text-right font-medium">
                        Website
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.data.topBusinesses.map((row) => (
                      <tr key={row.businessId} className="border-t border-cream-dark">
                        <th scope="row" className="py-2 pr-4 font-normal">
                          <Link
                            to={`/businesses/${row.slug}`}
                            className="text-terracotta underline"
                          >
                            {row.name}
                          </Link>
                        </th>
                        <td className="py-2 pr-4 text-right">{row.views}</td>
                        <td className="py-2 pr-4 text-right">{row.whatsappClicks}</td>
                        <td className="py-2 text-right">{row.websiteClicks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
