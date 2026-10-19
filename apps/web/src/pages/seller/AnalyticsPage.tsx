import { useState } from "react";
import { Link } from "react-router";
import { ActivityCharts, CLICK_NOTE, PeriodPicker, Tile } from "../../components/AnalyticsParts";
import { FormMessage, SecondaryButton } from "../../components/forms";
import { useBusinessAnalytics } from "../../lib/analytics";

/** How customers are finding and contacting the signed-in seller's business. */
export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const analytics = useBusinessAnalytics(days);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link to="/seller" className="text-sm font-medium text-terracotta underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Your analytics</h1>
      <p className="mt-1 text-sm text-ink-muted">
        See how many people looked at your profile and creations and opened your WhatsApp or website
        links. No personal details about visitors are collected.
      </p>

      <div className="mt-4">
        <PeriodPicker days={days} onChange={setDays} />
      </div>

      {analytics.isPending ? (
        <p role="status" className="mt-6">
          Loading your figures…
        </p>
      ) : analytics.isError ? (
        <div className="mt-6 space-y-3">
          <FormMessage kind="error">We couldn’t load your analytics. Please try again.</FormMessage>
          <SecondaryButton type="button" onClick={() => void analytics.refetch()}>
            Try again
          </SecondaryButton>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <dl className="grid gap-3 sm:grid-cols-3" aria-label={`Totals for the last ${days} days`}>
            <Tile
              label="Page views"
              value={analytics.data.totals.creationViews + analytics.data.totals.businessViews}
              note="Your profile and creations"
            />
            <Tile
              label="WhatsApp link clicks"
              value={analytics.data.totals.whatsappClicks}
              note="Times the link was opened"
            />
            <Tile label="Website link clicks" value={analytics.data.totals.websiteClicks} />
          </dl>

          {!analytics.data.hasData ? (
            <FormMessage kind="info">
              Nothing has been recorded in the last {days} days yet. Once customers start viewing
              your work, it will show up here.
            </FormMessage>
          ) : null}

          <ActivityCharts series={analytics.data.series} />
          <p className="text-sm text-ink-muted">{CLICK_NOTE}</p>

          <section
            aria-labelledby="top-heading"
            className="rounded-xl border border-cream-dark bg-white p-4"
          >
            <h2 id="top-heading" className="text-lg font-semibold">
              Your most popular creations
            </h2>
            {analytics.data.topCreations.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">
                No creation has been viewed or clicked in this period.
              </p>
            ) : (
              <div
                role="region"
                aria-label="Most popular creations"
                tabIndex={0}
                className="mt-2 overflow-x-auto"
              >
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr className="text-ink-muted">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Creation
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
                    {analytics.data.topCreations.map((row) => (
                      <tr key={row.creationId} className="border-t border-cream-dark">
                        <th scope="row" className="py-2 pr-4 font-normal">
                          <Link
                            to={`/seller/creations/${row.creationId}`}
                            className="text-terracotta underline"
                          >
                            {row.title}
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
    </main>
  );
}
