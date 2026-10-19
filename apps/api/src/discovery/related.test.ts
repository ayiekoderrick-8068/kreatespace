import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { createTestHarness, skippedHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

describe.skipIf(!hasDatabase)("related creations", () => {
  const { app, prisma } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const related = (id: string) => request(app).get(`/api/public/creations/${id}/related`);
  const titles = (res: request.Response) => res.body.items.map((i: { title: string }) => i.title);

  async function setup() {
    const kisumu = await buildBusiness(prisma, { name: "Kisumu Cakes", county: "Kisumu" });
    const nairobi = await buildBusiness(prisma, { name: "Nairobi Cakes", county: "Nairobi" });
    const decor = await buildBusiness(prisma, {
      name: "Decor Co",
      county: "Kisumu",
      categorySlug: "event-decor",
    });
    return { kisumu, nairobi, decor };
  }

  it("suggests creations in the same category, never the creation itself", async () => {
    const { kisumu, nairobi } = await setup();
    const source = await buildCreation(prisma, {
      businessId: kisumu.businessId,
      title: "Source Cake",
    });
    await buildCreation(prisma, { businessId: nairobi.businessId, title: "Other Cake" });
    const res = await related(source.creationId);
    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(["Other Cake"]);
  });

  it("includes other creations from the same business", async () => {
    const { kisumu } = await setup();
    const source = await buildCreation(prisma, {
      businessId: kisumu.businessId,
      title: "Source Cake",
    });
    await buildCreation(prisma, { businessId: kisumu.businessId, title: "Sibling Cake" });
    expect(titles(await related(source.creationId))).toEqual(["Sibling Cake"]);
  });

  it("also suggests the same occasion in a different category", async () => {
    const { kisumu, decor } = await setup();
    const source = await buildCreation(prisma, {
      businessId: kisumu.businessId,
      title: "Wedding Cake",
      occasionSlug: "wedding",
    });
    await buildCreation(prisma, {
      businessId: decor.businessId,
      title: "Wedding Arch",
      categorySlug: "event-decor",
      occasionSlug: "wedding",
    });
    expect(titles(await related(source.creationId))).toEqual(["Wedding Arch"]);
  });

  it("does not suggest something that only shares a county", async () => {
    const { kisumu, decor } = await setup();
    const source = await buildCreation(prisma, {
      businessId: kisumu.businessId,
      title: "Source Cake",
    });
    await buildCreation(prisma, {
      businessId: decor.businessId,
      title: "Unrelated Balloons",
      categorySlug: "event-decor",
    });
    expect(titles(await related(source.creationId))).toEqual([]);
  });

  it("ranks category plus occasion above category alone, and local above distant", async () => {
    const { kisumu, nairobi } = await setup();
    const source = await buildCreation(prisma, {
      businessId: kisumu.businessId,
      title: "Source",
      occasionSlug: "birthday",
      publishedAt: new Date(Date.UTC(2026, 0, 1)),
    });
    await buildCreation(prisma, {
      businessId: nairobi.businessId,
      title: "Category Only Far",
      publishedAt: new Date(Date.UTC(2026, 0, 5)),
    });
    await buildCreation(prisma, {
      businessId: kisumu.businessId,
      title: "Category Only Local",
      publishedAt: new Date(Date.UTC(2026, 0, 3)),
    });
    await buildCreation(prisma, {
      businessId: nairobi.businessId,
      title: "Category And Occasion",
      occasionSlug: "birthday",
      publishedAt: new Date(Date.UTC(2026, 0, 2)),
    });
    expect(titles(await related(source.creationId))).toEqual([
      "Category And Occasion",
      "Category Only Local",
      "Category Only Far",
    ]);
  });

  it("excludes unapproved, archived and suspended content", async () => {
    const { kisumu, nairobi } = await setup();
    const source = await buildCreation(prisma, { businessId: kisumu.businessId, title: "Source" });
    await buildCreation(prisma, {
      businessId: nairobi.businessId,
      title: "Pending",
      status: "PENDING",
    });
    await buildCreation(prisma, {
      businessId: nairobi.businessId,
      title: "Archived",
      status: "ARCHIVED",
    });
    await buildCreation(prisma, {
      businessId: nairobi.businessId,
      title: "Rejected",
      status: "REJECTED",
    });
    const suspended = await buildBusiness(prisma, { name: "Suspended", status: "SUSPENDED" });
    await buildCreation(prisma, { businessId: suspended.businessId, title: "From Suspended" });
    const pendingBiz = await buildBusiness(prisma, { name: "Pending Biz", status: "PENDING" });
    await buildCreation(prisma, { businessId: pendingBiz.businessId, title: "From Pending Biz" });
    await buildCreation(prisma, { businessId: nairobi.businessId, title: "Visible One" });
    expect(titles(await related(source.creationId))).toEqual(["Visible One"]);
  });

  it("limits the number of suggestions", async () => {
    const { kisumu } = await setup();
    const source = await buildCreation(prisma, { businessId: kisumu.businessId, title: "Source" });
    for (let i = 0; i < 12; i += 1) {
      await buildCreation(prisma, { businessId: kisumu.businessId, title: `Cake ${i}` });
    }
    expect((await related(source.creationId)).body.items).toHaveLength(8);
  });

  it("returns 404 for creations that are not public, and for unknown ids", async () => {
    const { kisumu } = await setup();
    const hidden = await buildCreation(prisma, {
      businessId: kisumu.businessId,
      title: "Hidden",
      status: "PENDING",
    });
    expect((await related(hidden.creationId)).status).toBe(404);
    expect((await related(randomUUID())).status).toBe(404);
    expect((await related("nope")).status).toBe(400);
  });
});
