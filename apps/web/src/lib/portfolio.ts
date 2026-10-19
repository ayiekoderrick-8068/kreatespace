import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api";
import { useApi } from "./queries";
import type { CreationSummary, OccasionOption, OwnCreation, Usage } from "./types";

export const portfolioKeys = {
  list: ["seller", "creations"] as const,
  one: (id: string) => ["seller", "creation", id] as const,
  occasions: ["occasions"] as const,
  packages: ["seller", "packages"] as const,
};

/** The signed-in seller's creations with how much of the free allowance is used. */
export function useOwnCreations(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: portfolioKeys.list,
    queryFn: () => api.get<{ creations: CreationSummary[]; usage: Usage }>("/api/creations"),
    enabled,
  });
}

export function useOwnCreation(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: portfolioKeys.one(id),
    queryFn: () => api.get<OwnCreation>(`/api/creations/${id}`),
  });
}

export function useOccasions() {
  return useQuery({
    queryKey: portfolioKeys.occasions,
    queryFn: async () =>
      (await apiRequest<{ occasions: OccasionOption[] }>("/api/occasions")).occasions,
    staleTime: 10 * 60_000,
  });
}
