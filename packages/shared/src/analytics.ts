import { z } from "zod";

/** Reporting windows offered on the analytics pages. */
export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const analyticsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine(
      (value): value is AnalyticsPeriod => (ANALYTICS_PERIODS as readonly number[]).includes(value),
      {
        message: "Choose 7, 30 or 90 days",
      },
    )
    .default(30),
});

export interface AnalyticsTotals {
  creationViews: number;
  businessViews: number;
  whatsappClicks: number;
  websiteClicks: number;
}

export interface AnalyticsDay extends AnalyticsTotals {
  /** Calendar day in Nairobi time, as `YYYY-MM-DD`. */
  date: string;
}
