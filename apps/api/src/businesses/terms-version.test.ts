import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { LEGAL_VERSION } from "@kreatespace/shared";
import {
  bearer,
  createTestHarness,
  hasDatabase,
  resetDatabase,
  skippedHarness,
} from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

describe.skipIf(!hasDatabase)("recording which seller terms were accepted", () => {
  const { app, prisma, actor, submittedBusiness } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  it("stores the version shown at the time, with the time of agreement", async () => {
    const seller = await actor("SELLER");
    const businessId = await submittedBusiness(seller);
    const revision = await prisma.businessRevision.findFirstOrThrow({ where: { businessId } });
    expect(revision.termsVersion).toBe(LEGAL_VERSION);
    expect(revision.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it("keeps the original agreement when a published profile is edited later", async () => {
    const seller = await actor("SELLER");
    const businessId = await submittedBusiness(seller);
    const admin = await actor("ADMIN");
    await request(app)
      .post(`/api/admin/businesses/${businessId}/decision`)
      .set(bearer(admin))
      .send({ action: "APPROVE" });
    const edit = await request(app).post("/api/businesses/me/revisions").set(bearer(seller));
    expect(edit.status).toBe(201);
    const revisions = await prisma.businessRevision.findMany({
      where: { businessId },
      orderBy: { version: "asc" },
    });
    expect(revisions).toHaveLength(2);
    expect(revisions[1]!.termsVersion).toBe(revisions[0]!.termsVersion);
    expect(revisions[1]!.termsAcceptedAt).toEqual(revisions[0]!.termsAcceptedAt);
  });

  it("clears the record if the agreement is withdrawn before submitting", async () => {
    const seller = await actor("SELLER");
    const created = await request(app)
      .post("/api/businesses")
      .set(bearer(seller))
      .send(await harness.businessDetails());
    expect(created.status).toBe(201);
    await request(app)
      .patch("/api/businesses/me")
      .set(bearer(seller))
      .send({ termsAccepted: true });
    await request(app)
      .patch("/api/businesses/me")
      .set(bearer(seller))
      .send({ termsAccepted: false });
    const revision = await prisma.businessRevision.findFirstOrThrow({
      where: { businessId: created.body.businessId },
    });
    expect(revision.termsVersion).toBeNull();
    expect(revision.termsAcceptedAt).toBeNull();
  });
});
