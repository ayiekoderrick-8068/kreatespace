import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeletionStatus } from "@kreatespace/shared";
import { useAuth } from "../auth/AuthProvider";
import { useApi } from "./queries";

/** What deleting an account would remove, in numbers (from GET /api/me/deletion). */
export interface DeletionEffects {
  role: "CUSTOMER" | "SELLER" | "ADMIN";
  savedCreations: number;
  business: {
    name: string | null;
    status: string;
    creations: number;
    packages: number;
    openWebsiteRequests: number;
    importInProgress: boolean;
  } | null;
}

export interface DeletionRequestView {
  id: string;
  status: DeletionStatus;
  requestedAt: string;
  /** Earliest day it can be carried out. */
  scheduledFor: string;
  /** True for business owners: an administrator must agree first. */
  needsReview: boolean;
  reviewNote: string | null;
  completedAt: string | null;
}

export interface DeletionState {
  request: DeletionRequestView | null;
  effects: DeletionEffects;
  graceDays: number;
}

/** A request that is still in progress, as opposed to one that was refused or withdrawn. */
export const isOpenDeletion = (request: DeletionRequestView | null | undefined) =>
  request?.status === "REQUESTED" || request?.status === "APPROVED";

export const deletionKey = (userId: string | undefined) => ["me", "deletion", userId] as const;

export function useDeletionState() {
  const api = useApi();
  const userId = useAuth().session?.user.id;
  return useQuery({
    queryKey: deletionKey(userId),
    queryFn: () => api.get<DeletionState>("/api/me/deletion"),
    enabled: Boolean(userId),
  });
}

export function useRequestDeletion() {
  const api = useApi();
  const queryClient = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: () => api.post("/api/me/deletion"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: deletionKey(userId) }),
  });
}

export function useCancelDeletion() {
  const api = useApi();
  const queryClient = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: () => api.delete("/api/me/deletion"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: deletionKey(userId) }),
  });
}
