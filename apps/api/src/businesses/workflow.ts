import type { BusinessStatus, RevisionStatus } from "@kreatespace/shared";

/** Revision states in which the owner may still change the content. */
const EDITABLE_REVISION: readonly RevisionStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

/** Revision states that count as "in flight" (at most one per business). */
export const OPEN_REVISION_STATUSES: readonly RevisionStatus[] = [
  "DRAFT",
  "PENDING",
  "CHANGES_REQUESTED",
];

/** Business states that block the owner from editing or submitting anything. */
const OWNER_LOCKED_BUSINESS: readonly BusinessStatus[] = ["REJECTED", "SUSPENDED"];

export function canOwnerEdit(business: BusinessStatus, revision: RevisionStatus): boolean {
  return !OWNER_LOCKED_BUSINESS.includes(business) && EDITABLE_REVISION.includes(revision);
}

export function canOwnerSubmit(business: BusinessStatus, revision: RevisionStatus): boolean {
  return canOwnerEdit(business, revision);
}

/**
 * Before a business has ever been approved its status mirrors its first revision.
 * Afterwards the business stays APPROVED while later revisions are reviewed.
 */
export function businessStatusAfterSubmit(
  current: BusinessStatus,
  hasPublishedRevision: boolean,
): BusinessStatus {
  return hasPublishedRevision ? current : "PENDING";
}
