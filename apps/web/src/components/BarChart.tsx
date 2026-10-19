const dayFormat = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** `2026-06-15` -> `15 Jun`. The value is a calendar day, so it is formatted in UTC on purpose. */
export const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));

export interface BarPoint {
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  value: number;
}

const W = 600;
const H = 160;
const PAD = { top: 12, right: 8, bottom: 24, left: 8 };

/**
 * One series of counts per day. A single series needs no legend: the title names it. Every bar
 * has a text tooltip, and the same numbers are available as a table for screen readers and for
 * anyone who prefers to read figures.
 */
export function BarChart({
  title,
  unit,
  points,
}: {
  title: string;
  unit: string;
  points: BarPoint[];
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const slot = (W - PAD.left - PAD.right) / Math.max(1, points.length);
  const barWidth = Math.max(2, slot - 2); // a 2px gap between neighbouring bars
  const plotHeight = H - PAD.top - PAD.bottom;
  const baseline = H - PAD.bottom;
  const labelAt = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);

  return (
    <figure className="rounded-xl border border-cream-dark bg-white p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-ink-muted">
          {total.toLocaleString("en-KE")} {unit} in total
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}: ${total} ${unit} over ${points.length} days. A table of the figures follows.`}
        className="mt-3 h-auto w-full"
      >
        {/* Recessive guides: one at the top of the scale, one at the baseline. */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top}
          y2={PAD.top}
          className="stroke-sand"
          strokeDasharray="3 4"
        />
        <text
          x={W - PAD.right}
          y={PAD.top - 3}
          textAnchor="end"
          className="fill-ink-muted text-[10px]"
        >
          {max}
        </text>
        {points.map((point, index) => {
          const height = point.value === 0 ? 0 : Math.max(2, (point.value / max) * plotHeight);
          const x = PAD.left + index * slot + (slot - barWidth) / 2;
          return (
            <g key={point.date}>
              <rect
                x={x}
                y={baseline - height}
                width={barWidth}
                height={height}
                rx={Math.min(3, barWidth / 2)}
                className="fill-terracotta"
              >
                <title>{`${formatDay(point.date)}: ${point.value} ${unit}`}</title>
              </rect>
              {labelAt.has(index) ? (
                <text
                  x={x + barWidth / 2}
                  y={H - 6}
                  textAnchor={
                    index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"
                  }
                  className="fill-ink-muted text-[10px]"
                >
                  {formatDay(point.date)}
                </text>
              ) : null}
            </g>
          );
        })}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={baseline}
          y2={baseline}
          className="stroke-ink-muted"
          strokeWidth="1"
        />
      </svg>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium text-terracotta underline">
          View as a table
        </summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-ink-muted">
              <th scope="col" className="py-1 pr-4 font-medium">
                Day
              </th>
              <th scope="col" className="py-1 font-medium">
                {unit}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date} className="border-t border-cream-dark">
                <th scope="row" className="py-1 pr-4 font-normal">
                  {formatDay(point.date)}
                </th>
                <td className="py-1">{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
