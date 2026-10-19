import type { CreationStatus, ReviewCommand, RevisionStatus } from "@kreatespace/shared";
import { describe, expect, it } from "vitest";
import {
  canArchive,
  canOwnerEdit,
  canStartRevision,
  creationStatusAfterSubmit,
  planCreationDecision,
} from "./workflow.js";

const plan = (
  command: ReviewCommand,
  creation: CreationStatus,
  revision: RevisionStatus | null,
  hasPublishedRevision = false,
) => planCreationDecision({ command, creation, revision, hasPublishedRevision });

describe("owner permissions", () => {
  it.each([
    ["DRAFT", "DRAFT", true],
    ["CHANGES_REQUESTED", "CHANGES_REQUESTED", true],
    ["PENDING", "PENDING", false],
    ["APPROVED", "APPROVED", false],
    ["APPROVED", "DRAFT", true],
    ["REJECTED", "REJECTED", false],
    ["SUSPENDED", "DRAFT", false],
    ["ARCHIVED", "DRAFT", false],
  ] as const)("creation %s / revision %s -> can edit: %s", (creation, revision, expected) => {
    expect(canOwnerEdit(creation, revision)).toBe(expected);
  });

  it("allows a new revision only for approved or rejected creations with nothing in flight", () => {
    expect(canStartRevision("APPROVED", false)).toBe(true);
    expect(canStartRevision("REJECTED", false)).toBe(true);
    expect(canStartRevision("APPROVED", true)).toBe(false);
    for (const status of [
      "DRAFT",
      "PENDING",
      "CHANGES_REQUESTED",
      "SUSPENDED",
      "ARCHIVED",
    ] as const) {
      expect(canStartRevision(status, false)).toBe(false);
    }
  });

  it("archives anything that is not already archived", () => {
    expect(canArchive("ARCHIVED")).toBe(false);
    expect(canArchive("DRAFT")).toBe(true);
    expect(canArchive("APPROVED")).toBe(true);
  });

  it("only changes status on submit before the first approval", () => {
    expect(creationStatusAfterSubmit("DRAFT", false)).toBe("PENDING");
    expect(creationStatusAfterSubmit("APPROVED", true)).toBe("APPROVED");
  });
});

describe("admin decisions", () => {
  it("approves and publishes a pending first submission", () => {
    expect(plan("APPROVE", "PENDING", "PENDING")).toEqual({
      ok: true,
      plan: {
        action: "APPROVED",
        revisionStatus: "APPROVED",
        creationStatus: "APPROVED",
        publish: true,
      },
    });
  });

  it("mirrors changes-requested and rejection onto an unpublished creation", () => {
    expect(plan("REQUEST_CHANGES", "PENDING", "PENDING")).toMatchObject({
      ok: true,
      plan: { creationStatus: "CHANGES_REQUESTED", revisionStatus: "CHANGES_REQUESTED" },
    });
    expect(plan("REJECT", "PENDING", "PENDING")).toMatchObject({
      ok: true,
      plan: { creationStatus: "REJECTED", revisionStatus: "REJECTED" },
    });
  });

  it("leaves a published creation approved when an update is returned or rejected", () => {
    for (const command of ["REQUEST_CHANGES", "REJECT"] as const) {
      const result = plan(command, "APPROVED", "PENDING", true);
      expect(result.ok && result.plan.creationStatus).toBeUndefined();
    }
    const approve = plan("APPROVE", "APPROVED", "PENDING", true);
    expect(approve.ok && approve.plan.publish).toBe(true);
  });

  it.each(["APPROVE", "REQUEST_CHANGES", "REJECT"] as const)(
    "%s needs a pending submission",
    (command) => {
      for (const revision of [
        null,
        "DRAFT",
        "APPROVED",
        "REJECTED",
        "CHANGES_REQUESTED",
      ] as const) {
        expect(plan(command, "DRAFT", revision)).toMatchObject({
          ok: false,
          code: "NOTHING_TO_REVIEW",
        });
      }
    },
  );

  it.each(["SUSPENDED", "ARCHIVED"] as const)(
    "does not review submissions of a %s creation",
    (status) => {
      expect(plan("APPROVE", status, "PENDING", true)).toMatchObject({
        ok: false,
        code: "CREATION_LOCKED",
      });
    },
  );

  it("suspends only approved creations and reinstates only suspended ones", () => {
    expect(plan("SUSPEND", "APPROVED", null, true)).toMatchObject({ ok: true });
    for (const status of [
      "DRAFT",
      "PENDING",
      "CHANGES_REQUESTED",
      "REJECTED",
      "SUSPENDED",
      "ARCHIVED",
    ] as const) {
      expect(plan("SUSPEND", status, null)).toMatchObject({
        ok: false,
        code: "INVALID_TRANSITION",
      });
    }
    expect(plan("REINSTATE", "SUSPENDED", null, true)).toMatchObject({
      ok: true,
      plan: { creationStatus: "APPROVED" },
    });
    for (const status of ["DRAFT", "PENDING", "APPROVED", "REJECTED", "ARCHIVED"] as const) {
      expect(plan("REINSTATE", status, null)).toMatchObject({ ok: false });
    }
  });
});
