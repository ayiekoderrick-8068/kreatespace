import type { BusinessStatus, InvitationStatus, RevisionStatus } from "@kreatespace/shared";

const LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Awaiting review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  ACCEPTED: "Accepted",
  REVOKED: "Revoked",
  EXPIRED: "Expired",
};

const STYLES: Record<string, string> = {
  DRAFT: "bg-cream-dark text-ink",
  PENDING: "bg-amber-100 text-amber-900",
  CHANGES_REQUESTED: "bg-orange-100 text-orange-900",
  APPROVED: "bg-green-100 text-green-900",
  ACCEPTED: "bg-green-100 text-green-900",
  REJECTED: "bg-red-100 text-red-900",
  SUSPENDED: "bg-red-100 text-red-900",
  REVOKED: "bg-red-100 text-red-900",
  EXPIRED: "bg-cream-dark text-ink-muted",
};

export function statusLabel(status: BusinessStatus | RevisionStatus | InvitationStatus): string {
  return LABELS[status] ?? status;
}

export function StatusBadge({
  status,
  kind = "review",
}: {
  status: BusinessStatus | RevisionStatus | InvitationStatus;
  /** Invitations use "Pending"; review states use "Awaiting review". */
  kind?: "review" | "invitation";
}) {
  const label = kind === "invitation" && status === "PENDING" ? "Pending" : statusLabel(status);
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status] ?? STYLES.DRAFT}`}
    >
      {label}
    </span>
  );
}
