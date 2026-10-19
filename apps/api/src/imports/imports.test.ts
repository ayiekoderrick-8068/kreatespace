import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildCreation } from "../dev/builders.js";
import { fakePng } from "../test/fake-storage.js";
import {
  bearer,
  createTestHarness,
  hasDatabase,
  resetDatabase,
  skippedHarness,
} from "../test/harness.js";
import { createSafeFetcher } from "./safe-fetch.js";
import { failStaleJobs } from "./service.js";

// --- a small fake website, served from this machine -----------------------------------------------

const pages: Record<string, { type: string; body: string | Buffer }> = {};
const hits: string[] = [];
let server: http.Server;
let port = 0;

const html = (body: string) => ({
  type: "text/html; charset=utf-8",
  body: `<html><body>${body}</body></html>`,
});
const product = (title: string, text: string, image: string) =>
  html(`<main><h1>${title}</h1><p>${text}</p><img src="${image}"></main>`);

function resetSite() {
  for (const key of Object.keys(pages)) delete pages[key];
  hits.length = 0;
  Object.assign(pages, {
    "/": html(`<main><h1>Maria Cakes</h1><p>Welcome to Maria Cakes, custom cakes baked in Nairobi.</p><img src="/img/hero.png"></main>
      <a href="/cakes/floral">Floral</a> <a href="/cakes/plain">Plain</a> <a href="/about">About</a>
      <a href="/private/menu">Private</a> <a href="http://other.test/elsewhere">Elsewhere</a>`),
    "/cakes/floral": product(
      "Floral Wedding Cake",
      "A three tier vanilla cake decorated with fresh flowers, baked to order in Nairobi.",
      "/img/floral.png",
    ),
    "/cakes/plain": product(
      "Plain Cake",
      "A simple sponge cake with buttercream, perfect for a small birthday party.",
      "/img/plain.png",
    ),
    "/about": html("<main><h1>About</h1><p>Hi.</p></main>"),
    "/private/menu": product(
      "Secret Menu Cake",
      "A cake the website owner asked robots not to read, with extra detail here.",
      "/img/floral.png",
    ),
    "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private\n" },
    "/img/hero.png": { type: "image/png", body: fakePng(1200, 800) },
    "/img/floral.png": { type: "image/png", body: fakePng(800, 1000) },
    "/img/plain.png": { type: "image/png", body: fakePng(800, 800) },
  });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    const page = pages[(req.url ?? "").split("?")[0]!];
    if (!page) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", page.type);
    res.end(page.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// --- harness --------------------------------------------------------------------------------------

const pending: Promise<void>[] = [];
let hold = false;
const held: (() => Promise<void>)[] = [];

const fetcher = () =>
  createSafeFetcher({
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    allowAddress: (address) => address === "127.0.0.1",
    allowPort: () => true,
    timeoutMs: 3000,
  });

const importer = {
  fetcher: hasDatabase ? fetcher() : (undefined as never),
  delayMs: 0,
  schedule: (run: () => Promise<void>) => {
    if (hold) held.push(run);
    else pending.push(run());
  },
};

const harness = hasDatabase ? createTestHarness({ importer }) : skippedHarness();

/** Waits for every scheduled crawl to finish. */
const settled = async () => {
  await Promise.all(pending.splice(0));
};

describe.skipIf(!hasDatabase)("authorised website importing", () => {
  const { app, prisma, actor, sellerWithBusiness, categoryId, files } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
    resetSite();
    hold = false;
    held.length = 0;
    pending.length = 0;
    files.clear();
  });

  const siteUrl = () => `http://shop.test:${port}`;

  async function setup(options: { websiteUrl?: string | null } = {}) {
    const admin = await actor("ADMIN");
    const business = await sellerWithBusiness({
      name: "Maria Cakes",
      websiteUrl: options.websiteUrl === undefined ? siteUrl() : options.websiteUrl,
    });
    return { admin, ...business };
  }

  const grant = (admin: { token: string; id: string; email: string }, businessId: string) =>
    request(app).post("/api/admin/imports/authorizations").set(bearer(admin)).send({ businessId });

  async function authorise(admin: Parameters<typeof grant>[0], businessId: string) {
    const res = await grant(admin, businessId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }

  async function runImport(
    admin: Parameters<typeof grant>[0],
    authorizationId: string,
    body: object = {},
  ) {
    const res = await request(app)
      .post("/api/admin/imports/jobs")
      .set(bearer(admin))
      .send({ authorizationId, startUrl: `${siteUrl()}/`, ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await settled();
    return res.body.id as string;
  }

  const items = async (admin: Parameters<typeof grant>[0], query = "") =>
    (await request(app).get(`/api/admin/imports/items${query}`).set(bearer(admin))).body.items as {
      id: string;
      title: string;
      status: string;
      duplicateReason: string | null;
      imageUrls: string[];
    }[];

  // --- authorisation ---

  describe("authorisation", () => {
    it("takes the domain from the business's own approved website", async () => {
      const { admin, businessId } = await setup({
        websiteUrl: "https://www.MariaCakes.co.ke/shop",
      });
      const res = await grant(admin, businessId);
      expect(res.status).toBe(201);
      expect(res.body.domain).toBe("mariacakes.co.ke");

      const list = await request(app).get("/api/admin/imports/authorizations").set(bearer(admin));
      expect(list.body.authorizations).toMatchObject([
        { domain: "mariacakes.co.ke", businessName: "Maria Cakes", revokedAt: null },
      ]);
    });

    it("refuses businesses that cannot be imported from", async () => {
      const admin = await actor("ADMIN");
      const refused = async (options: Parameters<typeof sellerWithBusiness>[0], code: string) => {
        const { businessId } = await sellerWithBusiness({
          name: `Biz ${randomUUID().slice(0, 6)}`,
          ...options,
        });
        const res = await grant(admin, businessId);
        expect(res.status, JSON.stringify(options)).toBe(409);
        expect(res.body.error.code).toBe(code);
      };
      await refused({ websiteUrl: null }, "NO_WEBSITE");
      await refused({ websiteUrl: "https://vercel.app" }, "DOMAIN_NOT_ELIGIBLE");
      await refused({ websiteUrl: "http://169.254.169.254/" }, "DOMAIN_NOT_ELIGIBLE");
      await refused({ websiteUrl: "http://localhost:3000" }, "DOMAIN_NOT_ELIGIBLE");
      await refused({ websiteUrl: "http://intranet/" }, "DOMAIN_NOT_ELIGIBLE");
      await refused({ websiteUrl: "https://co.ke" }, "DOMAIN_NOT_ELIGIBLE");
      await refused(
        { status: "PENDING", websiteUrl: "https://pending.example.co.ke" },
        "BUSINESS_NOT_APPROVED",
      );
    });

    it("needs the business to have confirmed it owns its content", async () => {
      const { admin, businessId, revisionId } = await setup();
      await prisma.businessRevision.update({
        where: { id: revisionId },
        data: { contentAuthorizedAt: null },
      });
      const res = await grant(admin, businessId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONTENT_NOT_AUTHORIZED");
    });

    it("cannot be granted twice, and can be revoked", async () => {
      const { admin, businessId } = await setup();
      const id = await authorise(admin, businessId);
      expect((await grant(admin, businessId)).body.error.code).toBe("ALREADY_AUTHORIZED");

      const revoked = await request(app)
        .delete(`/api/admin/imports/authorizations/${id}`)
        .set(bearer(admin));
      expect(revoked.status).toBe(204);
      // Revoking again, or an unknown id, is the same clean 404.
      expect(
        (await request(app).delete(`/api/admin/imports/authorizations/${id}`).set(bearer(admin)))
          .status,
      ).toBe(404);
      // A revoked authorisation can be granted afresh.
      expect((await grant(admin, businessId)).status).toBe(201);
    });

    it("is only available to administrators", async () => {
      const { admin, seller, businessId } = await setup();
      const customer = await actor("CUSTOMER");
      const id = await authorise(admin, businessId);
      const calls = (who?: Parameters<typeof grant>[0]) => {
        const auth = (r: request.Test) => (who ? r.set(bearer(who)) : r);
        return [
          auth(request(app).get("/api/admin/imports/authorizations")),
          auth(request(app).post("/api/admin/imports/authorizations").send({ businessId })),
          auth(request(app).delete(`/api/admin/imports/authorizations/${id}`)),
          auth(request(app).get("/api/admin/imports/jobs")),
          auth(request(app).post("/api/admin/imports/jobs").send({ authorizationId: id })),
          auth(request(app).get("/api/admin/imports/items")),
          auth(request(app).post(`/api/admin/imports/items/${randomUUID()}/accept`).send({})),
          auth(request(app).post(`/api/admin/imports/items/${randomUUID()}/reject`)),
        ];
      };
      for (const response of await Promise.all(calls())) expect(response.status).toBe(401);
      for (const who of [seller, customer]) {
        for (const response of await Promise.all(calls(who))) expect(response.status).toBe(403);
      }
      expect(await prisma.importJob.count()).toBe(0);
    });
  });

  // --- crawling ---

  describe("importing a website", () => {
    it("stages pages for review, honouring robots.txt, depth and the authorised domain", async () => {
      const { admin, businessId } = await setup();
      const authorizationId = await authorise(admin, businessId);
      const jobId = await runImport(admin, authorizationId);

      const job = (await request(app).get("/api/admin/imports/jobs").set(bearer(admin))).body
        .jobs[0];
      expect(job).toMatchObject({
        id: jobId,
        status: "COMPLETED",
        domain: "shop.test",
        failure: null,
      });
      // Home, floral, plain and about were read; the private page and the other website were not.
      expect(job.pagesFetched).toBe(4);
      expect(hits).toContain("/robots.txt");
      expect(hits).not.toContain("/private/menu");
      expect(hits.some((h) => h.includes("elsewhere"))).toBe(false);

      const staged = await items(admin);
      expect(staged.map((i) => i.title).sort()).toEqual([
        "Floral Wedding Cake",
        "Maria Cakes",
        "Plain Cake",
      ]);
      expect(staged.every((i) => i.status === "PENDING_REVIEW")).toBe(true);
      // "About" had no photos or description, so it was skipped rather than staged.
      expect(job.skipped).toBeGreaterThanOrEqual(1);
      // Nothing was created or published.
      expect(await prisma.creation.count()).toBe(0);
      expect(files.size).toBe(0);
    });

    it("flags pages that duplicate an existing creation or each other", async () => {
      const { admin, businessId } = await setup();
      await buildCreation(prisma, { businessId, title: "Plain Cake" });
      pages["/cakes/copy"] = product(
        "Floral Wedding Cake!",
        "A three tier vanilla cake decorated with fresh flowers, baked to order in Nairobi.",
        "/img/floral.png",
      );
      pages["/"] =
        html(`<main><h1>Maria Cakes</h1><p>Welcome to Maria Cakes, custom cakes baked in Nairobi.</p><img src="/img/hero.png"></main>
        <a href="/cakes/floral">a</a> <a href="/cakes/plain">b</a> <a href="/cakes/copy">c</a>`);
      const authorizationId = await authorise(admin, businessId);
      await runImport(admin, authorizationId);

      const staged = await items(admin);
      const byTitle = new Map(staged.map((i) => [i.title, i]));
      expect(byTitle.get("Plain Cake")).toMatchObject({
        status: "DUPLICATE",
        duplicateReason: "A creation with the same title already exists.",
      });
      expect(byTitle.get("Floral Wedding Cake")?.status).toBe("PENDING_REVIEW");
      expect(byTitle.get("Floral Wedding Cake!")?.status).toBe("DUPLICATE");
    });

    it("never repeats work when run again", async () => {
      const { admin, businessId } = await setup();
      const authorizationId = await authorise(admin, businessId);
      await runImport(admin, authorizationId);
      const before = await prisma.importItem.count();
      await runImport(admin, authorizationId);
      expect(await prisma.importItem.count()).toBe(before);
      const jobs = (await request(app).get("/api/admin/imports/jobs").set(bearer(admin))).body.jobs;
      expect(jobs[0]).toMatchObject({ status: "COMPLETED", itemsFound: 0 });
    });

    it("keeps imports to one address inside the authorised website", async () => {
      const { admin, businessId } = await setup();
      const authorizationId = await authorise(admin, businessId);
      for (const startUrl of [
        "http://other.test/",
        "https://shop.test.evil.com/",
        "ftp://shop.test/",
        "http://169.254.169.254/",
      ]) {
        const res = await request(app)
          .post("/api/admin/imports/jobs")
          .set(bearer(admin))
          .send({ authorizationId, startUrl });
        expect(res.status, startUrl).toBe(400);
      }
      expect(await prisma.importJob.count()).toBe(0);
    });

    it("allows one running import per business and a few per day", async () => {
      const { admin, businessId } = await setup();
      const authorizationId = await authorise(admin, businessId);
      const start = () =>
        request(app)
          .post("/api/admin/imports/jobs")
          .set(bearer(admin))
          .send({ authorizationId, startUrl: `${siteUrl()}/` });

      hold = true;
      expect((await start()).status).toBe(202);
      const second = await start();
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("IMPORT_RUNNING");

      // A job that was interrupted long ago stops blocking the business.
      await prisma.importJob.updateMany({
        data: { createdAt: new Date(Date.now() - 30 * 60_000) },
      });
      expect(await failStaleJobs(prisma)).toBe(1);
      expect((await prisma.importJob.findFirstOrThrow()).failureCode).toBe("INTERRUPTED");

      hold = false;
      for (let n = 0; n < 3; n++) {
        expect((await start()).status).toBe(202);
        await settled();
      }
      // Four earlier jobs inside a day; the fifth is the last allowed, the sixth is refused.
      expect((await start()).status).toBe(202);
      await settled();
      const refused = await start();
      expect(refused.status).toBe(429);
      expect(refused.body.error.code).toBe("IMPORT_LIMIT");
    });

    it("stops safely when the website points at an internal address, telling nothing about it", async () => {
      const guarded = createTestHarness({
        importer: {
          // Real safety rules; the name resolves to a private network address.
          fetcher: createSafeFetcher({
            resolve: async () => [{ address: "10.20.30.40", family: 4 }],
            allowPort: () => true,
          }),
          delayMs: 0,
          schedule: (run) => {
            pending.push(run());
          },
        },
      });
      const admin = await guarded.actor("ADMIN");
      const { businessId } = await sellerWithBusiness({ name: "Sneaky", websiteUrl: siteUrl() });
      const grantRes = await request(guarded.app)
        .post("/api/admin/imports/authorizations")
        .set(bearer(admin))
        .send({ businessId });
      expect(grantRes.status).toBe(201);
      const before = hits.length;
      await request(guarded.app)
        .post("/api/admin/imports/jobs")
        .set(bearer(admin))
        .send({ authorizationId: grantRes.body.id, startUrl: `${siteUrl()}/` });
      await settled();

      expect(hits.length).toBe(before);
      const jobs = (await request(guarded.app).get("/api/admin/imports/jobs").set(bearer(admin)))
        .body.jobs;
      expect(jobs[0].status).toBe("FAILED");
      expect(jobs[0].failure).toBe("The website’s address can’t be imported from.");
      expect(JSON.stringify(jobs)).not.toContain("10.20.30.40");
      expect((await prisma.importJob.findFirstOrThrow()).failureCode).toBe("BLOCKED_ADDRESS");
      expect(await prisma.importItem.count()).toBe(0);
    });

    it("fails clearly when the start page cannot be read, and when robots.txt forbids it", async () => {
      const { admin, businessId } = await setup();
      const authorizationId = await authorise(admin, businessId);

      await runImport(admin, authorizationId, { startUrl: `${siteUrl()}/missing` });
      pages["/robots.txt"] = {
        type: "text/plain",
        body: "User-agent: KreateSpaceImporter\nDisallow: /\n",
      };
      await runImport(admin, authorizationId);

      const jobs = (await request(app).get("/api/admin/imports/jobs").set(bearer(admin))).body.jobs;
      expect(jobs.map((j: { failure: string }) => j.failure)).toEqual([
        "The website asks automated visitors not to read this page.",
        "The website returned an error.",
      ]);
      expect(await prisma.importItem.count()).toBe(0);
    });
  });

  // --- reviewing ---

  describe("reviewing imported pages", () => {
    async function staged(options: { websiteUrl?: string | null } = {}) {
      const ctx = await setup(options);
      const authorizationId = await authorise(ctx.admin, ctx.businessId);
      await runImport(ctx.admin, authorizationId);
      const all = await items(ctx.admin);
      const floral = all.find((i) => i.title === "Floral Wedding Cake")!;
      return { ...ctx, authorizationId, floral, all };
    }

    const accept = (admin: Parameters<typeof grant>[0], id: string, body: object) =>
      request(app).post(`/api/admin/imports/items/${id}/accept`).set(bearer(admin)).send(body);

    it("turns an accepted page into a private draft with checked photos in our own storage", async () => {
      const { admin, floral, businessId } = await staged();
      const res = await accept(admin, floral.id, { categoryId: await categoryId("cakes") });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ imagesImported: 1, imagesSkipped: 0 });

      const creation = await prisma.creation.findUniqueOrThrow({
        where: { id: res.body.creationId },
        include: { revisions: { include: { images: true } } },
      });
      // A draft only: not approved, not published, not visible to the public.
      expect(creation).toMatchObject({ businessId, status: "DRAFT", publishedRevisionId: null });
      expect(creation.revisions[0]).toMatchObject({
        status: "DRAFT",
        title: "Floral Wedding Cake",
      });
      const image = creation.revisions[0]!.images[0]!;
      expect(image).toMatchObject({ width: 800, height: 1000, position: 0 });
      expect(image.path).toMatch(
        new RegExp(`^businesses/${businessId}/creations/${creation.id}/[0-9a-f-]{36}\\.png$`),
      );
      expect(files.has(image.path)).toBe(true);
      expect(await request(app).get(`/api/public/creations/${creation.id}`)).toMatchObject({
        status: 404,
      });

      const item = await prisma.importItem.findUniqueOrThrow({ where: { id: floral.id } });
      expect(item).toMatchObject({ status: "ACCEPTED", creationId: creation.id });
      expect(
        await prisma.auditLog.count({
          where: { action: { in: ["import.item_accepted", "creation.imported"] } },
        }),
      ).toBe(2);
    });

    it("lets the reviewer correct the text, and validates it", async () => {
      const { admin, floral } = await staged();
      const category = await categoryId("cakes");
      const bad = await accept(admin, floral.id, { categoryId: category, title: "No" });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.fields).toHaveProperty("title");
      expect((await accept(admin, floral.id, {})).status).toBe(400);
      expect((await accept(admin, floral.id, { categoryId: randomUUID() })).status).toBe(400);
      expect(files.size).toBe(0);

      const ok = await accept(admin, floral.id, {
        categoryId: category,
        title: "Floral Wedding Cake (3 tier)",
        description: "A three tier vanilla wedding cake with fresh flowers, made to order.",
      });
      expect(ok.status).toBe(201);
      const revision = await prisma.creationRevision.findFirstOrThrow({
        where: { creationId: ok.body.creationId },
      });
      expect(revision.title).toBe("Floral Wedding Cake (3 tier)");
    });

    it("needs explicit confirmation to import a suspected duplicate", async () => {
      const { admin, businessId } = await setup();
      await buildCreation(prisma, { businessId, title: "Plain Cake" });
      const authorizationId = await authorise(admin, businessId);
      await runImport(admin, authorizationId);
      const dupe = (await items(admin)).find((i) => i.status === "DUPLICATE")!;
      const category = await categoryId("cakes");

      const refused = await accept(admin, dupe.id, { categoryId: category });
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("DUPLICATE_UNCONFIRMED");
      expect(files.size).toBe(0);
      expect(
        (await accept(admin, dupe.id, { categoryId: category, confirmDuplicate: true })).status,
      ).toBe(201);
    });

    it("lets only one of two simultaneous accepts through, and leaves no stray files", async () => {
      const { admin, floral, businessId } = await staged();
      const category = await categoryId("cakes");
      const results = await Promise.all([
        accept(admin, floral.id, { categoryId: category }),
        accept(admin, floral.id, { categoryId: category }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.creation.count({ where: { businessId } })).toBe(1);
      const keep = await prisma.creationImage.findMany({ select: { path: true } });
      expect([...files].sort()).toEqual(keep.map((k) => k.path).sort());
    });

    it("respects the 20-creation limit and cleans up after a refusal", async () => {
      const { admin, floral, businessId } = await staged();
      for (let n = 0; n < 20; n++) {
        await buildCreation(prisma, { businessId, title: `Existing ${n}`, status: "DRAFT" });
      }
      const res = await accept(admin, floral.id, { categoryId: await categoryId("cakes") });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CREATION_LIMIT_REACHED");
      expect(files.size).toBe(0);
      expect((await prisma.importItem.findUniqueOrThrow({ where: { id: floral.id } })).status).toBe(
        "PENDING_REVIEW",
      );
    });

    it("skips photos that are not safe and refuses a page with none left", async () => {
      const { admin, floral } = await staged();
      const category = await categoryId("cakes");
      // One photo is on another website, one is not really an image, one is fine.
      await prisma.importItem.update({
        where: { id: floral.id },
        data: {
          imageUrls: [
            "http://other.test/steal.png",
            `${siteUrl()}/img/fake.png`,
            `${siteUrl()}/img/floral.png`,
          ],
        },
      });
      pages["/img/fake.png"] = { type: "image/png", body: "<html>not an image</html>" };
      const ok = await accept(admin, floral.id, { categoryId: category });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ imagesImported: 1, imagesSkipped: 2 });

      // Another page where nothing usable remains.
      const other = (await items(admin)).find((i) => i.title === "Maria Cakes")!;
      await prisma.importItem.update({
        where: { id: other.id },
        data: {
          imageUrls: [
            "http://other.test/x.png",
            `${siteUrl()}/img/fake.png`,
            `${siteUrl()}/img/missing.png`,
          ],
        },
      });
      const none = await accept(admin, other.id, { categoryId: category });
      expect(none.status).toBe(422);
      expect(none.body.error.code).toBe("NO_USABLE_PHOTOS");
      expect(await prisma.creation.count()).toBe(1);
      expect((await prisma.importItem.findUniqueOrThrow({ where: { id: other.id } })).status).toBe(
        "PENDING_REVIEW",
      );
    });

    it("can reject a page, once", async () => {
      const { admin, floral } = await staged();
      const reject = () =>
        request(app).post(`/api/admin/imports/items/${floral.id}/reject`).set(bearer(admin));
      expect((await reject()).body.status).toBe("REJECTED");
      expect((await reject()).status).toBe(409);
      expect(
        (await accept(admin, floral.id, { categoryId: await categoryId("cakes") })).status,
      ).toBe(409);
      expect(await prisma.creation.count()).toBe(0);
      // A rejected page is not offered again by a later import.
      const authorizationId = (await prisma.importAuthorization.findFirstOrThrow()).id;
      await runImport(admin, authorizationId);
      expect(await prisma.importItem.count({ where: { sourceUrl: { contains: "floral" } } })).toBe(
        1,
      );
    });

    it("stops once the authorisation is revoked", async () => {
      const { admin, floral, authorizationId } = await staged();
      await request(app)
        .delete(`/api/admin/imports/authorizations/${authorizationId}`)
        .set(bearer(admin));
      const res = await accept(admin, floral.id, { categoryId: await categoryId("cakes") });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("AUTHORIZATION_REVOKED");
      expect(
        (
          await request(app)
            .post("/api/admin/imports/jobs")
            .set(bearer(admin))
            .send({ authorizationId })
        ).status,
      ).toBe(404);
      expect(files.size).toBe(0);
    });

    it("will not create drafts for a business that has been suspended", async () => {
      const { admin, floral, businessId } = await staged();
      await prisma.business.update({ where: { id: businessId }, data: { status: "SUSPENDED" } });
      const res = await accept(admin, floral.id, { categoryId: await categoryId("cakes") });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("BUSINESS_NOT_APPROVED");
    });

    it("keeps imported drafts out of other sellers' hands", async () => {
      const { admin, floral, seller } = await staged();
      const other = await sellerWithBusiness({ name: "Someone Else" });
      const { body } = await accept(admin, floral.id, { categoryId: await categoryId("cakes") });
      const owner = await request(app).get(`/api/creations/${body.creationId}`).set(bearer(seller));
      expect(owner.status).toBe(200);
      const stranger = await request(app)
        .get(`/api/creations/${body.creationId}`)
        .set(bearer(other.seller));
      expect(stranger.status).toBe(404);
    });
  });
});
