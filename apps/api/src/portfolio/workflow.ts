import type {
  CreationStatus,
  ReviewAction,
  ReviewCommand,
  RevisionStatus,
} from "@kreatespace/shared";

/** Revision states that count as "in flight" (at most one per creation). */
export const OPEN_REVISION_STATUSES: readonly RevisionStatus[] = [
  "DRAFT",
  "PENDING",
  "CHANGES_REQUESTED",
];

const EDITABLE_REVISION: readonly RevisionStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

/** Creation states in which the owner cannot change anything. */
const OWNER_LOCKED: readonly CreationStatus[] = ["ARCHIVED", "SUSPENDED"];

export function canOwnerEdit(creation: CreationStatus, revision: RevisionStatus): boolean {
  return !OWNER_LOCKED.includes(creation) && EDITABLE_REVISION.includes(revision);
}

/**
 * An approved creation, or one whose first submission was rejected, can be edited by starting a
 * new revision. Nothing else can: unpublished drafts are edited in place.
 */
export function canStartRevision(creation: CreationStatus, hasOpenRevision: boolean): boolean {
  return (creation === "APPROVED" || creation === "REJECTED") && !hasOpenRevision;
}

export function canArchive(creation: CreationStatus): boolean {
  return creation !== "ARCHIVED";
}

/** Before first publication the creation's status mirrors its first revision. */
export function creationStatusAfterSubmit(
  current: CreationStatus,
  hasPublishedRevision: boolean,
): CreationStatus {
  return hasPublishedRevision ? current : "PENDING";
}

export interface DecisionPlan {
  action: ReviewAction;
  revisionStatus?: RevisionStatus;
  creationStatus?: CreationStatus;
  /** Whether the revision becomes the one visitors see. */
  publish?: boolean;
}

export type DecisionResult =
  { ok: true; plan: DecisionPlan } | { ok: false; code: string; message: string };

const refuse = (code: string, message: string): DecisionResult => ({ ok: false, code, message });

/**
 * The single source of truth for admin transitions on creations.
 *
 *   Revision:  PENDING ──approve──▶ APPROVED (published)
 *              PENDING ──request changes──▶ CHANGES_REQUESTED ──(owner resubmits)──▶ PENDING
 *              PENDING ──reject──▶ REJECTED
 *   Creation:  APPROVED ──suspend──▶ SUSPENDED ──reinstate──▶ APPROVED
 */
export function planCreationDecision(input: {
  command: ReviewCommand;
  creation: CreationStatus;
  hasPublishedRevision: boolean;
  revision: RevisionStatus | null;
}): DecisionResult {
  const { command, creation, hasPublishedRevision, revision } = input;
  const mirrorsRevision = !hasPublishedRevision;

  switch (command) {
    case "APPROVE":
    case "REQUEST_CHANGES":
    case "REJECT": {
      if (revision !== "PENDING") {
        return refuse("NOTHING_TO_REVIEW", "There is no submission awaiting review");
      }
      if (creation === "SUSPENDED" || creation === "ARCHIVED") {
        return refuse("CREATION_LOCKED", `A ${creation.toLowerCase()} creation can't be reviewed`);
      }
      if (command === "APPROVE") {
        return {
          ok: true,
          plan: {
            action: "APPROVED",
            revisionStatus: "APPROVED",
            creationStatus: "APPROVED",
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
          creationStatus: mirrorsRevision ? revisionStatus : undefined,
        },
      };
    }
    case "SUSPEND":
      if (creation !== "APPROVED") {
        return refuse("INVALID_TRANSITION", "Only approved creations can be suspended");
      }
      return { ok: true, plan: { action: "SUSPENDED", creationStatus: "SUSPENDED" } };
    case "REINSTATE":
      if (creation !== "SUSPENDED") {
        return refuse("INVALID_TRANSITION", "Only suspended creations can be reinstated");
      }
      return { ok: true, plan: { action: "REINSTATED", creationStatus: "APPROVED" } };
  }
}
