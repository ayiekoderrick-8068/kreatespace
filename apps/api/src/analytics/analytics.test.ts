import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import {
  bearer,
  createTestHarness,
  hasDatabase,
  resetDatabase,
  skippedHarness,
} from "../test/harness.js";
import { getBusinessAnalytics } from "./service.js";

const harness = hasDatabase ? createTestHarness() : skippedHarness();

describe.skipIf(!hasDatabase)("seller and platform analytics", () => {
  const { app, prisma, actor, sellerWithBusiness } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

  async function event(
    businessId: string,
    type: "CREATION_VIEW" | "BUSINESS_VIEW" | "WHATSAPP_CLICK" | "WEBSITE_CLICK",
    options: { creationId?: string; createdAt?: Date } = {},
  ) {
    await prisma.inquiryEvent.create({
      data: { type, businessId, creationId: options.creationId, createdAt: options.createdAt },
    });
  }

  it("reports a seller's own totals, a zero-filled daily series and top creations", async () => {
    const { seller, businessId } = await sellerWithBusiness({ name: "Cakes by Maria" });
    const floral = await buildCreation(prisma, { businessId, title: "Floral Cake" });
    const plain = await buildCreation(prisma, { businessId, title: "Plain Cake" });

    await event(businessId, "CREATION_VIEW", { creationId: floral.creationId });
    await event(businessId, "CREATION_VIEW", { creationId: floral.creationId });
    await event(businessId, "CREATION_VIEW", { creationId: plain.creationId });
    await event(businessId, "WHATSAPP_CLICK", { creationId: floral.creationId });
    await event(businessId, "BUSINESS_VIEW");
    await event(businessId, "WEBSITE_CLICK");

    const res = await request(app).get("/api/analytics?days=7").set(bearer(seller));
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    expect(res.body.totals).toEqual({
      creationViews: 3,
      businessViews: 1,
      whatsappClicks: 1,
      websiteClicks: 1,
    });
    expect(res.body.series).toHaveLength(7);
    // Today is the last entry and holds every event; earlier days are present and empty.
    expect(res.body.series[6].creationViews).toBe(3);
    expect(res.body.series[0]).toMatchObject({ creationViews: 0, whatsappClicks: 0 });
    expect(res.body.topCreations[0]).toMatchObject({
      title: "Floral Cake",
      views: 2,
      whatsappClicks: 1,
    });
    expect(res.body.topCreations[1]).toMatchObject({ title: "Plain Cake", views: 1 });
    expect(res.body.hasData).toBe(true);
  });

  it("only counts events inside the chosen window", async () => {
    const { seller, businessId } = await sellerWithBusiness({ name: "Old and New" });
    await event(businessId, "BUSINESS_VIEW");
    await event(businessId, "BUSINESS_VIEW", { createdAt: daysAgo(20) });
    await event(businessId, "BUSINESS_VIEW", { createdAt: daysAgo(60) });

    const totalFor = async (days: number) =>
      (await request(app).get(`/api/analytics?days=${days}`).set(bearer(seller))).body.totals
        .businessViews;
    expect(await totalFor(7)).toBe(1);
    expect(await totalFor(30)).toBe(2);
    expect(await totalFor(90)).toBe(3);
  });

  it("assigns an event to its Nairobi calendar day, not its UTC day", async () => {
    const { seller, businessId } = await sellerWithBusiness({ name: "Late Night" });
    const now = new Date("2026-06-15T10:00:00Z");
    // 22:30 UTC on 14 June is 01:30 on 15 June in Nairobi (UTC+3).
    await event(businessId, "BUSINESS_VIEW", { createdAt: new Date("2026-06-14T22:30:00Z") });
    const result = await getBusinessAnalytics(prisma, { userId: seller.id, days: 7, now });
    const day = result.series.find((entry) => entry.date === "2026-06-15");
    expect(day?.businessViews).toBe(1);
    expect(result.series.find((entry) => entry.date === "2026-06-14")?.businessViews).toBe(0);
  });

  it("never mixes in another business's events", async () => {
    const mine = await sellerWithBusiness({ name: "Mine" });
    const theirs = await sellerWithBusiness({ name: "Theirs" });
    const theirCreation = await buildCreation(prisma, {
      businessId: theirs.businessId,
      title: "Secret Plan",
    });
    await event(theirs.businessId, "WHATSAPP_CLICK", { creationId: theirCreation.creationId });
    await event(mine.businessId, "BUSINESS_VIEW");

    const res = await request(app).get("/api/analytics").set(bearer(mine.seller));
    expect(res.body.totals.whatsappClicks).toBe(0);
    expect(res.body.topCreations).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain("Secret Plan");
  });

  it("shows honest zeros for a business with no activity", async () => {
    const { seller } = await sellerWithBusiness({ name: "Brand New" });
    const res = await request(app).get("/api/analytics").set(bearer(seller));
    expect(res.status).toBe(200);
    expect(res.body.hasData).toBe(false);
    expect(res.body.totals).toEqual({
      creationViews: 0,
      businessViews: 0,
      whatsappClicks: 0,
      websiteClicks: 0,
    });
    expect(res.body.series).toHaveLength(30);
  });

  it("rejects an unsupported window and unauthorised callers", async () => {
    const { seller } = await sellerWithBusiness({ name: "Windows" });
    expect((await request(app).get("/api/analytics?days=45").set(bearer(seller))).status).toBe(400);
    expect((await request(app).get("/api/analytics?days=abc").set(bearer(seller))).status).toBe(
      400,
    );
    expect((await request(app).get("/api/analytics")).status).toBe(401);
    const customer = await actor("CUSTOMER");
    expect((await request(app).get("/api/analytics").set(bearer(customer))).status).toBe(403);
    const admin = await actor("ADMIN");
    expect((await request(app).get("/api/analytics").set(bearer(admin))).status).toBe(403);
  });

  it("refuses analytics until the business is approved", async () => {
    const { seller } = await sellerWithBusiness({ name: "Waiting", status: "PENDING" });
    expect((await request(app).get("/api/analytics").set(bearer(seller))).status).toBe(403);
  });

  it("gives administrators platform-wide figures and nobody else", async () => {
    const a = await buildBusiness(prisma, { name: "Alpha Bakes" });
    const b = await buildBusiness(prisma, { name: "Beta Snaps", status: "PENDING" });
    await buildCreation(prisma, { businessId: a.businessId, title: "Alpha Cake" });
    await buildCreation(prisma, {
      businessId: a.businessId,
      title: "Alpha Pending",
      status: "PENDING",
    });
    await event(a.businessId, "WHATSAPP_CLICK");
    await event(a.businessId, "BUSINESS_VIEW");
    await event(b.businessId, "BUSINESS_VIEW");

    const admin = await actor("ADMIN");
    const res = await request(app).get("/api/admin/analytics?days=30").set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ whatsappClicks: 1, businessViews: 2 });
    expect(res.body.businesses).toMatchObject({ APPROVED: 1, PENDING: 1 });
    expect(res.body.creations).toMatchObject({ APPROVED: 1, PENDING: 1 });
    expect(res.body.queues).toMatchObject({ businessesPending: 1, creationsPending: 1 });
    expect(res.body.topBusinesses[0]).toMatchObject({ name: "Alpha Bakes", whatsappClicks: 1 });

    const seller = await sellerWithBusiness({ name: "Gamma" });
    expect((await request(app).get("/api/admin/analytics").set(bearer(seller.seller))).status).toBe(
      403,
    );
    expect((await request(app).get("/api/admin/analytics")).status).toBe(401);
  });
});
