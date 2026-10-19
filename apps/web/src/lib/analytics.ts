import { useQuery } from "@tanstack/react-query";
import type { AnalyticsDay, AnalyticsTotals } from "@kreatespace/shared";
import { useApi } from "./queries";

export interface BusinessAnalytics {
  days: number;
  from: string;
  totals: AnalyticsTotals;
  series: AnalyticsDay[];
  topCreations: {
    creationId: string;
    title: string;
    views: number;
    whatsappClicks: number;
    websiteClicks: number;
  }[];
  hasData: boolean;
}

export interface PlatformAnalytics {
  days: number;
  from: string;
  totals: AnalyticsTotals;
  series: AnalyticsDay[];
  businesses: Record<string, number>;
  creations: Record<string, number>;
  users: Record<string, number>;
  queues: {
    businessesPending: number;
    creationsPending: number;
    packagesPending: number;
    websiteRequestsNew: number;
  };
  topBusinesses: {
    businessId: string;
    name: string;
    slug: string;
    views: number;
    whatsappClicks: number;
    websiteClicks: number;
  }[];
}

export function useBusinessAnalytics(days: number) {
  const api = useApi();
  return useQuery({
    queryKey: ["seller", "analytics", days],
    queryFn: () => api.get<BusinessAnalytics>(`/api/analytics?days=${days}`),
  });
}

export function usePlatformAnalytics(days: number) {
  const api = useApi();
  return useQuery({
    queryKey: ["admin", "analytics", days],
    queryFn: () => api.get<PlatformAnalytics>(`/api/admin/analytics?days=${days}`),
  });
}
