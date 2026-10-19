import type { BusinessStatus, ReviewCommand, RevisionStatus } from "@kreatespace/shared";
import { describe, expect, it } from "vitest";
import {
  businessStatusAfterSubmit,
  canOwnerEdit,
  canOwnerSubmit,
  canStartRevision,
  planDecision,
} from "./workflow.js";

const plan = (
  command: ReviewCommand,
  business: BusinessStatus,
  revision: RevisionStatus | null,
  hasPublishedRevision = false,
) => planDecision({ command, business, revision, hasPublishedRevision });

describe("owner permissions", () => {
  it.each([
    ["DRAFT", "DRAFT", true],
    ["CHANGES_REQUESTED", "CHANGES_REQUESTED", true],
    ["PENDING", "PENDING", false],
    ["APPROVED", "PENDING", false],
    ["APPROVED", "DRAFT", true],
    ["REJECTED", "REJECTED", false],
    ["SUSPENDED", "DRAFT", false],
    ["APPROVED", "APPROVED", false],
  ] as const)("business %s / revision %s -> can edit: %s", (business, revision, expected) => {
    expect(canOwnerEdit(business, revision)).toBe(expected);
    expect(canOwnerSubmit(business, revision)).toBe(expected);
  });

  it("allows a new revision only for an approved business with nothing in flight", () => {
    expect(canStartRevision("APPROVED", false)).toBe(true);
    expect(canStartRevision("APPROVED", true)).toBe(false);
    for (const status of [
      "DRAFT",
      "PENDING",
      "CHANGES_REQUESTED",
      "REJECTED",
      "SUSPENDED",
    ] as const) {
      expect(canStartRevision(status, false)).toBe(false);
    }
  });

  it("only changes business status on submit before first approval", () => {
    expect(businessStatusAfterSubmit("DRAFT", false)).toBe("PENDING");
    expect(businessStatusAfterSubmit("CHANGES_REQUESTED", false)).toBe("PENDING");
    expect(businessStatusAfterSubmit("APPROVED", true)).toBe("APPROVED");
  });
});

describe("admin decisions on a first application", () => {
  it("approves a pending application and publishes it", () => {
    expect(plan("APPROVE", "PENDING", "PENDING")).toEqual({
      ok: true,
      plan: {
        action: "APPROVED",
        revisionStatus: "APPROVED",
        businessStatus: "APPROVED",
        publish: true,
      },
    });
  });

  it("requests changes and mirrors the status on the business", () => {
    expect(plan("REQUEST_CHANGES", "PENDING", "PENDING")).toEqual({
      ok: true,
      plan: {
        action: "CHANGES_REQUESTED",
        revisionStatus: "CHANGES_REQUESTED",
        businessStatus: "CHANGES_REQUESTED",
      },
    });
  });

  it("rejects and mirrors the status on the business", () => {
    expect(plan("REJECT", "PENDING", "PENDING")).toEqual({
      ok: true,
      plan: { action: "REJECTED", revisionStatus: "REJECTED", businessStatus: "REJECTED" },
    });
  });
});

describe("admin decisions on a profile update of a published business", () => {
  it("rejecting an update leaves the business approved", () => {
    const result = plan("REJECT", "APPROVED", "PENDING", true);
    expect(result).toEqual({
      ok: true,
      plan: { action: "REJECTED", revisionStatus: "REJECTED", businessStatus: undefined },
    });
  });

  it("requesting changes to an update leaves the business approved", () => {
    const result = plan("REQUEST_CHANGES", "APPROVED", "PENDING", true);
    expect(result.ok && result.plan.businessStatus).toBeUndefined();
  });

  it("approving an update publishes the new revision", () => {
    const result = plan("APPROVE", "APPROVED", "PENDING", true);
    expect(result.ok && result.plan.publish).toBe(true);
  });
});

describe("invalid transitions", () => {
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
        const result = plan(command, "DRAFT", revision);
        expect(result).toMatchObject({ ok: false, code: "NOTHING_TO_REVIEW" });
      }
    },
  );

  it("does not review submissions of a suspended business", () => {
    expect(plan("APPROVE", "SUSPENDED", "PENDING", true)).toMatchObject({
      ok: false,
      code: "BUSINESS_SUSPENDED",
    });
  });

  it.each(["DRAFT", "PENDING", "CHANGES_REQUESTED", "REJECTED", "SUSPENDED"] as const)(
    "cannot suspend a %s business",
    (status) => {
      expect(plan("SUSPEND", status, null)).toMatchObject({
        ok: false,
        code: "INVALID_TRANSITION",
      });
    },
  );

  it("suspends only approved businesses", () => {
    expect(plan("SUSPEND", "APPROVED", null, true)).toEqual({
      ok: true,
      plan: { action: "SUSPENDED", businessStatus: "SUSPENDED" },
    });
  });

  it.each(["DRAFT", "PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const)(
    "cannot reinstate a %s business",
    (status) => {
      expect(plan("REINSTATE", status, null)).toMatchObject({
        ok: false,
        code: "INVALID_TRANSITION",
      });
    },
  );

  it("reinstates only suspended businesses", () => {
    expect(plan("REINSTATE", "SUSPENDED", null, true)).toEqual({
      ok: true,
      plan: { action: "REINSTATED", businessStatus: "APPROVED" },
    });
  });
});
