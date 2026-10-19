import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ApiError, apiRequest } from "./api";
import type { Category, CurrentUser, OwnBusiness } from "./types";

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
