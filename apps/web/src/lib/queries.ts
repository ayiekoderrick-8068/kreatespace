import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ApiError, apiRequest } from "./api";
import type {
  Category,
  CreationDetail,
  CreationPage,
  CurrentUser,
  FilterOptions,
  HomeData,
  OwnBusiness,
} from "./types";

/** API helpers bound to the signed-in user's access token. */
export function useApi() {
  const token = useAuth().session?.access_token;
  return useMemo(
    () => ({
      get: <T>(path: string) => apiRequest<T>(path, { token }),
      post: <T>(path: string, body?: unknown) =>
        apiRequest<T>(path, { method: "POST", body: body ?? {}, token }),
      patch: <T>(path: string, body: unknown) =>
        apiRequest<T>(path, { method: "PATCH", body, token }),
      put: <T>(path: string, body?: unknown) =>
        apiRequest<T>(path, { method: "PUT", body: body ?? {}, token }),
      delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE", token }),
    }),
    [token],
  );
}

export const queryKeys = {
  me: (userId: string | undefined) => ["me", userId] as const,
  categories: ["categories"] as const,
  ownBusiness: ["own-business"] as const,
  invitations: ["admin", "invitations"] as const,
  adminBusinesses: (params: object) => ["admin", "businesses", params] as const,
  adminBusiness: (id: string) => ["admin", "business", id] as const,
  publicBusiness: (slug: string) => ["public", "business", slug] as const,
  feed: (filters: DiscoveryFilters) => ["public", "creations", filters] as const,
  creation: (id: string) => ["public", "creation", id] as const,
  related: (id: string) => ["public", "related", id] as const,
  home: ["public", "home"] as const,
  filterOptions: ["public", "filters"] as const,
  cities: (county: string) => ["public", "cities", county] as const,
  savedIds: (userId: string | undefined) => ["saved", "ids", userId] as const,
  savedList: ["saved", "list"] as const,
};

export function useCurrentUser() {
  const { session } = useAuth();
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.me(session?.user.id),
    queryFn: async () => (await api.get<{ user: CurrentUser }>("/api/me")).user,
    enabled: Boolean(session),
    staleTime: 60_000,
  });
}

export function useCategories() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: async () => (await api.get<{ categories: Category[] }>("/api/categories")).categories,
    staleTime: 10 * 60_000,
  });
}

/** The signed-in seller's business, or `null` when they have not registered one yet. */
export function useOwnBusiness(options?: Partial<UseQueryOptions<OwnBusiness | null>>) {
  const api = useApi();
  return useQuery<OwnBusiness | null>({
    queryKey: queryKeys.ownBusiness,
    queryFn: async () => {
      try {
        return await api.get<OwnBusiness>("/api/businesses/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    ...options,
  });
}

/** Discovery filters as they appear in the page address, so results can be shared. */
export interface DiscoveryFilters {
  q?: string;
  category?: string;
  occasion?: string;
  county?: string;
  city?: string;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search.toString();
}

/** Newest-first feed, loaded one page at a time. */
export function useCreationFeed(filters: DiscoveryFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.feed(filters),
    queryFn: ({ pageParam }) =>
      apiRequest<CreationPage>(
        `/api/public/creations?${toQueryString({ ...filters, page: pageParam })}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}

export function useCreation(id: string) {
  return useQuery({
    queryKey: queryKeys.creation(id),
    queryFn: async () =>
      (await apiRequest<{ creation: CreationDetail }>(`/api/public/creations/${id}`)).creation,
    staleTime: 60_000,
  });
}

export function useRelatedCreations(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.related(id),
    queryFn: async () =>
      (await apiRequest<CreationPage>(`/api/public/creations/${id}/related`)).items,
    enabled,
    staleTime: 60_000,
  });
}

export function useHome() {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: () => apiRequest<HomeData>("/api/public/home"),
    staleTime: 30_000,
  });
}

export function useFilterOptions() {
  return useQuery({
    queryKey: queryKeys.filterOptions,
    queryFn: () => apiRequest<FilterOptions>("/api/public/filters"),
    staleTime: 10 * 60_000,
  });
}

export function useCities(county: string | undefined) {
  return useQuery({
    queryKey: queryKeys.cities(county ?? ""),
    queryFn: async () =>
      (
        await apiRequest<{ cities: string[] }>(
          `/api/public/cities?county=${encodeURIComponent(county!)}`,
        )
      ).cities,
    enabled: Boolean(county),
    staleTime: 5 * 60_000,
  });
}

/** Ids of the signed-in user's saved creations (empty when signed out). */
export function useSavedIds() {
  const { session } = useAuth();
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.savedIds(session?.user.id),
    queryFn: async () => (await api.get<{ ids: string[] }>("/api/me/saved/ids")).ids,
    enabled: Boolean(session),
    staleTime: 60_000,
  });
}

/** The signed-in user's saved creations, loaded a page at a time. */
export function useSavedFeed(enabled: boolean) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.savedList,
    queryFn: ({ pageParam }) => api.get<CreationPage>(`/api/me/saved?page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled,
  });
}

/** Saves or removes a creation, updating the heart immediately and rolling back on failure. */
export function useToggleSave() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const api = useApi();
  const idsKey = queryKeys.savedIds(session?.user.id);

  return useMutation({
    mutationFn: ({ creationId, save }: { creationId: string; save: boolean }) =>
      save ? api.put(`/api/me/saved/${creationId}`) : api.delete(`/api/me/saved/${creationId}`),
    onMutate: async ({ creationId, save }) => {
      await queryClient.cancelQueries({ queryKey: idsKey });
      const previous = queryClient.getQueryData<string[]>(idsKey);
      queryClient.setQueryData<string[]>(idsKey, (ids = []) =>
        save
          ? [creationId, ...ids.filter((id) => id !== creationId)]
          : ids.filter((id) => id !== creationId),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(idsKey, context.previous);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: idsKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.savedList }),
      ]);
    },
  });
}
