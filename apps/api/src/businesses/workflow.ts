import type {
  BusinessStatus,
  ReviewAction,
  ReviewCommand,
  RevisionStatus,
} from "@kreatespace/shared";

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

/** Only an approved business with nothing in flight may start a new revision. */
export function canStartRevision(business: BusinessStatus, hasOpenRevision: boolean): boolean {
  return business === "APPROVED" && !hasOpenRevision;
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

export interface DecisionPlan {
  action: ReviewAction;
  /** New status for the revision under review (revision-level commands only). */
  revisionStatus?: RevisionStatus;
  /** New status for the business. */
  businessStatus?: BusinessStatus;
  /** Whether the revision becomes the one visitors see. */
  publish?: boolean;
}

export type DecisionResult =
  { ok: true; plan: DecisionPlan } | { ok: false; code: string; message: string };

const refuse = (code: string, message: string): DecisionResult => ({ ok: false, code, message });

/**
 * The single source of truth for admin transitions.
 *
 *   Revision:  PENDING ──approve──▶ APPROVED (published)
 *              PENDING ──request changes──▶ CHANGES_REQUESTED ──(owner resubmits)──▶ PENDING
 *              PENDING ──reject──▶ REJECTED
 *   Business:  APPROVED ──suspend──▶ SUSPENDED ──reinstate──▶ APPROVED
 *
 * While a business has never been approved, its status follows its first revision.
 */
export function planDecision(input: {
  command: ReviewCommand;
  business: BusinessStatus;
  hasPublishedRevision: boolean;
  revision: RevisionStatus | null;
}): DecisionResult {
  const { command, business, hasPublishedRevision, revision } = input;
  const mirrorsRevision = !hasPublishedRevision;

  switch (command) {
    case "APPROVE":
    case "REQUEST_CHANGES":
    case "REJECT": {
      if (revision !== "PENDING") {
        return refuse("NOTHING_TO_REVIEW", "There is no submission awaiting review");
      }
      if (business === "SUSPENDED") {
        return refuse("BUSINESS_SUSPENDED", "Reinstate the business before reviewing changes");
      }
      if (command === "APPROVE") {
        return {
          ok: true,
          plan: {
            action: "APPROVED",
            revisionStatus: "APPROVED",
            businessStatus: "APPROVED",
            publish: true,
          },
        };
      }
      const revisionStatus = command === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";
      return {
        ok: true,
        plan: {
          action: revisionStatus,
          revisionStatus,
          businessStatus: mirrorsRevision ? revisionStatus : undefined,
        },
      };
    }
    case "SUSPEND":
      if (business !== "APPROVED") {
        return refuse("INVALID_TRANSITION", "Only approved businesses can be suspended");
      }
      return { ok: true, plan: { action: "SUSPENDED", businessStatus: "SUSPENDED" } };
    case "REINSTATE":
      if (business !== "SUSPENDED") {
        return refuse("INVALID_TRANSITION", "Only suspended businesses can be reinstated");
      }
      return { ok: true, plan: { action: "REINSTATED", businessStatus: "APPROVED" } };
  }
}
