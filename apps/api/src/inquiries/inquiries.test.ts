import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";
import { getInquirySummary, purgeOldInquiryEvents } from "./service.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("inquiry analytics events", () => {
  const { app, prisma, actor } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  const send = (body: unknown) =>
    request(app)
      .post("/api/public/events")
      .send(body as object);

  async function live() {
    const business = await buildBusiness(prisma, { name: "Cakes by Maria" });
    const { creationId } = await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Floral Cake",
    });
    return { ...business, creationId };
  }

  it("records views and clicks without any sign-in", async () => {
    const { businessId, creationId, slug } = await live();
    expect((await send({ type: "CREATION_VIEW", creationId })).status).toBe(202);
    expect((await send({ type: "BUSINESS_VIEW", businessSlug: slug })).status).toBe(202);
    expect(
      (
        await send({
          type: "WHATSAPP_CLICK",
          businessSlug: slug,
          creationId,
          source: "creation_page",
        })
      ).status,
    ).toBe(202);
    expect(
      (await send({ type: "WEBSITE_CLICK", businessSlug: slug, source: "business_page" })).status,
    ).toBe(202);

    const events = await prisma.inquiryEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual([
      "CREATION_VIEW",
      "BUSINESS_VIEW",
      "WHATSAPP_CLICK",
      "WEBSITE_CLICK",
    ]);
    expect(events.every((e) => e.businessId === businessId)).toBe(true);
    expect(events[2]).toMatchObject({ creationId, source: "creation_page" });
  });

  it("stores nothing about the visitor, whatever they send", async () => {
    const { slug } = await live();
    await request(app)
      .post("/api/public/events")
      .set("User-Agent", "Secret Browser 1.0")
      .set("X-Forwarded-For", "203.0.113.9")
      .send({
        type: "WHATSAPP_CLICK",
        businessSlug: slug,
        phone: "0712345678",
        email: "customer@example.com",
        message: "Hello, I need a cake for Saturday",
        userId: randomUUID(),
      });
    const row = await prisma.inquiryEvent.findFirstOrThrow();
    const stored = JSON.stringify(row);
    for (const secret of [
      "0712345678",
      "customer@example.com",
      "Saturday",
      "Secret Browser",
      "203.0.113.9",
    ]) {
      expect(stored).not.toContain(secret);
    }
    expect(Object.keys(row).sort()).toEqual(
      ["businessId", "createdAt", "creationId", "id", "packageId", "source", "type"].sort(),
    );
  });

  it("works for signed-in users the same way, without linking events to accounts", async () => {
    const { slug } = await live();
    await actor("CUSTOMER");
    expect((await send({ type: "BUSINESS_VIEW", businessSlug: slug })).status).toBe(202);
    expect(Object.keys(await prisma.inquiryEvent.findFirstOrThrow())).not.toContain("userId");
  });

  it("refuses events about content that is not public", async () => {
    const pending = await buildBusiness(prisma, { name: "Pending Co", status: "PENDING" });
    const suspended = await buildBusiness(prisma, { name: "Suspended Co", status: "SUSPENDED" });
    const hidden = await buildCreation(prisma, {
      businessId: suspended.businessId,
      title: "Hidden",
    });
    const draft = await live();
    const draftCreation = await buildCreation(prisma, {
      businessId: draft.businessId,
      title: "Draft",
      status: "DRAFT",
    });

    for (const body of [
      { type: "BUSINESS_VIEW", businessSlug: pending.slug },
      { type: "BUSINESS_VIEW", businessSlug: suspended.slug },
      { type: "CREATION_VIEW", creationId: hidden.creationId },
      { type: "CREATION_VIEW", creationId: draftCreation.creationId },
      { type: "BUSINESS_VIEW", businessSlug: "nobody-here" },
      { type: "CREATION_VIEW", creationId: randomUUID() },
    ]) {
      expect((await send(body)).status, JSON.stringify(body)).toBe(404);
    }
    expect(await prisma.inquiryEvent.count()).toBe(0);
  });

  it("refuses a creation attributed to the wrong business, and unknown packages", async () => {
    const a = await live();
    const b = await buildBusiness(prisma, { name: "Other Bakes" });
    expect(
      (await send({ type: "WHATSAPP_CLICK", businessSlug: b.slug, creationId: a.creationId }))
        .status,
    ).toBe(404);
    expect(
      (
        await send({
          type: "WHATSAPP_CLICK",
          businessSlug: a.slug,
          packageId: randomUUID(),
          source: "package",
        })
      ).status,
    ).toBe(404);
  });

  it("validates the payload", async () => {
    for (const body of [
      {},
      { type: "CREATION_VIEW" },
      { type: "MESSAGE_SENT", businessSlug: "x" },
      { type: "BUSINESS_VIEW", businessSlug: "Bad Slug!" },
      { type: "BUSINESS_VIEW", businessSlug: "ok", source: "elsewhere" },
    ]) {
      expect((await send(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("is rate limited per client", async () => {
    const limited = createTestHarness({ rateLimiting: true });
    const { slug } = await live();
    let last = 0;
    for (let i = 0; i < 201; i += 1) {
      last = (
        await request(limited.app)
          .post("/api/public/events")
          .send({ type: "BUSINESS_VIEW", businessSlug: slug })
      ).status;
    }
    expect(last).toBe(429);
  });

  it("summarises views and link clicks for a business, ready for the dashboard", async () => {
    const { businessId, creationId, slug } = await live();
    const other = await buildCreation(prisma, { businessId, title: "Second Cake" });
    for (const body of [
      { type: "CREATION_VIEW", creationId },
      { type: "CREATION_VIEW", creationId },
      { type: "CREATION_VIEW", creationId: other.creationId },
      { type: "WHATSAPP_CLICK", businessSlug: slug, creationId },
      { type: "WEBSITE_CLICK", businessSlug: slug },
      { type: "BUSINESS_VIEW", businessSlug: slug },
    ]) {
      await send(body);
    }
    const summary = await getInquirySummary(prisma, {
      businessId,
      since: new Date(Date.now() - 86_400_000),
    });
    expect(summary.totals).toEqual({
      CREATION_VIEW: 3,
      BUSINESS_VIEW: 1,
      WHATSAPP_CLICK: 1,
      WEBSITE_CLICK: 1,
    });
    expect(summary.creations[0]).toEqual({
      creationId,
      views: 2,
      whatsappClicks: 1,
      websiteClicks: 0,
    });
    expect(summary.creations[1]).toMatchObject({ creationId: other.creationId, views: 1 });

    const future = await getInquirySummary(prisma, {
      businessId,
      since: new Date(Date.now() + 86_400_000),
    });
    expect(future.totals.CREATION_VIEW).toBe(0);
  });

  it("deletes events past the retention period", async () => {
    const { businessId } = await live();
    await prisma.inquiryEvent.createMany({
      data: [
        { type: "BUSINESS_VIEW", businessId, createdAt: new Date(Date.now() - 500 * 86_400_000) },
        { type: "BUSINESS_VIEW", businessId },
      ],
    });
    expect(await purgeOldInquiryEvents(prisma)).toBe(1);
    expect(await prisma.inquiryEvent.count()).toBe(1);
    expect(await purgeOldInquiryEvents(prisma)).toBe(0);
  });
});
