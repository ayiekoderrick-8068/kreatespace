import { ANALYTICS_PERIODS } from "@kreatespace/shared";
import type { AnalyticsDay } from "@kreatespace/shared";
import { BarChart } from "./BarChart";

const number = new Intl.NumberFormat("en-KE");

/** 7 / 30 / 90 day choice; a plain group of toggle buttons that works with keyboard and touch. */
export function PeriodPicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (days: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time period"
      className="inline-flex rounded-lg border border-sand bg-white p-0.5"
    >
      {ANALYTICS_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          aria-pressed={days === period}
          onClick={() => onChange(period)}
          className={`min-h-11 rounded-md px-4 text-sm font-medium sm:min-h-9 ${
            days === period ? "bg-terracotta text-white" : "text-ink hover:bg-cream"
          }`}
        >
          Last {period} days
        </button>
      ))}
    </div>
  );
}

export function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-xl border border-cream-dark bg-white px-4 py-3">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-3xl font-semibold">{number.format(value)}</dd>
      {note ? <p className="mt-0.5 text-xs text-ink-muted">{note}</p> : null}
    </div>
  );
}

/** The two daily charts shared by the seller and administrator pages. */
export function ActivityCharts({ series }: { series: AnalyticsDay[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BarChart
        title="Page views per day"
        unit="views"
        points={series.map((day) => ({
          date: day.date,
          value: day.creationViews + day.businessViews,
        }))}
      />
      <BarChart
        title="WhatsApp link clicks per day"
        unit="clicks"
        points={series.map((day) => ({ date: day.date, value: day.whatsappClicks }))}
      />
    </div>
  );
}

export const CLICK_NOTE =
  "A WhatsApp click means the link was opened. It doesn’t tell us whether a message was sent.";
