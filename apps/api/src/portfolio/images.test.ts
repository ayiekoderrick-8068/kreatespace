import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCreation } from "../dev/builders.js";
import { cleanupOrphanedUploads } from "./images.js";
import { fakeJpeg, fakePng } from "../test/fake-storage.js";
import { bearer, createTestHarness, hasDatabase, resetDatabase } from "../test/harness.js";

const harness = hasDatabase ? createTestHarness() : null;

describe.skipIf(!hasDatabase)("creation image uploads", () => {
  const { app, prisma, sellerWithBusiness, files, putFile, storage } = harness!;

  beforeEach(async () => {
    await resetDatabase(prisma);
    files.clear();
  });

  type Owner = Awaited<ReturnType<typeof sellerWithBusiness>>;

  async function draft(owner: Owner) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } });
    const res = await request(app).post("/api/creations").set(bearer(owner.seller)).send({
      title: "Floral Birthday Cake",
      description: "Three-tier vanilla sponge decorated with hand-made sugar flowers.",
      categoryId: category.id,
    });
    return res.body.creationId as string;
  }

  const target = (owner: Owner, id: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(`/api/creations/${id}/uploads`)
      .set(bearer(owner.seller))
      .send({ contentType: "image/jpeg", size: 200_000, ...body });
  const confirm = (owner: Owner, id: string, path: string) =>
    request(app).post(`/api/creations/${id}/images`).set(bearer(owner.seller)).send({ path });

  /** Requests a target, "uploads" bytes to it, and returns the path. */
  async function uploaded(
    owner: Owner,
    id: string,
    bytes = fakeJpeg(),
    contentType = "image/jpeg",
  ) {
    const res = await target(owner, id, { contentType });
    expect(res.status).toBe(201);
    putFile(res.body.path, bytes);
    return res.body.path as string;
  }

  describe("upload targets", () => {
    it("issues a unique path inside this creation's own folder", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const a = await target(owner, id);
      const b = await target(owner, id, { contentType: "image/png" });
      expect(a.status).toBe(201);
      const folder = `businesses/${owner.businessId}/creations/${id}/`;
      expect(a.body.path).toMatch(new RegExp(`^${folder}[0-9a-f-]{36}\\.jpg$`));
      expect(b.body.path).toMatch(/\.png$/);
      expect(a.body.path).not.toBe(b.body.path);
      expect(a.body.uploadUrl).toContain(a.body.path);
    });

    it.each([
      ["application/pdf", 1000],
      ["image/svg+xml", 1000],
      ["image/gif", 1000],
      ["text/html", 1000],
      ["image/jpeg", 6 * 1024 * 1024],
      ["image/jpeg", 0],
    ])("refuses %s of %i bytes", async (contentType, size) => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      expect((await target(owner, id, { contentType, size })).status).toBe(400);
    });

    it("is private to the creation's owner", async () => {
      const owner = await sellerWithBusiness();
      const other = await sellerWithBusiness();
      const id = await draft(owner);
      expect((await target(other, id)).status).toBe(404);
    });

    it("is closed while the creation is awaiting review", async () => {
      const owner = await sellerWithBusiness();
      const { creationId } = await buildCreation(prisma, {
        businessId: owner.businessId,
        title: "Pending",
        status: "PENDING",
      });
      expect((await target(owner, creationId)).status).toBe(409);
    });
  });

  describe("confirming an upload", () => {
    it("attaches a real image with its true dimensions and serves it privately", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const path = await uploaded(owner, id, fakeJpeg(1200, 900));

      const res = await confirm(owner, id, path);
      expect(res.status).toBe(201);
      expect(res.body.revision.images).toHaveLength(1);
      expect(res.body.revision.images[0]).toMatchObject({
        position: 0,
        width: 1200,
        height: 900,
        url: `https://storage.test/read/${path}`,
      });
      expect(await prisma.auditLog.count({ where: { action: "creation.image_added" } })).toBe(1);
    });

    it("keeps the order photos were added in", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      for (let i = 0; i < 3; i += 1)
        await confirm(owner, id, await uploaded(owner, id, fakePng(800 + i, 1000), "image/png"));
      const res = await request(app).get(`/api/creations/${id}`).set(bearer(owner.seller));
      expect(res.body.revision.images.map((i: { width: number }) => i.width)).toEqual([
        800, 801, 802,
      ]);
    });

    it("rejects a path that was never uploaded to", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const res = await target(owner, id);
      const attempt = await confirm(owner, id, res.body.path);
      expect(attempt.status).toBe(400);
      expect(attempt.body.error.code).toBe("UPLOAD_MISSING");
    });

    it.each([
      ["a GIF pretending to be a PNG", Buffer.from("GIF89a" + "x".repeat(40)), "image/png"],
      ["an HTML page", Buffer.from("<html><script>alert(1)</script></html>"), "image/jpeg"],
      [
        "an SVG with script",
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
        "image/png",
      ],
      ["an empty file", Buffer.alloc(0), "image/jpeg"],
      ["plain text", Buffer.from("not an image at all"), "image/webp"],
    ])("rejects %s and deletes it from storage", async (_label, bytes, contentType) => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const path = await uploaded(owner, id, bytes, contentType);
      const res = await confirm(owner, id, path);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_IMAGE");
      expect(files.has(path)).toBe(false);
      expect(await prisma.creationImage.count()).toBe(0);
    });

    it("rejects a file whose real type differs from its name", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const path = await uploaded(owner, id, fakePng(), "image/jpeg"); // PNG bytes at a .jpg path
      const res = await confirm(owner, id, path);
      expect(res.status).toBe(400);
      expect(files.has(path)).toBe(false);
    });

    it("rejects images that are too small, too large in pixels, or too heavy", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const tiny = await uploaded(owner, id, fakeJpeg(100, 100));
      const huge = await uploaded(owner, id, fakeJpeg(12_000, 9_000));
      const heavy = await uploaded(
        owner,
        id,
        Buffer.concat([fakeJpeg(), Buffer.alloc(5 * 1024 * 1024)]),
      );
      for (const path of [tiny, huge, heavy]) {
        const res = await confirm(owner, id, path);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_IMAGE");
      }
      expect(await prisma.creationImage.count()).toBe(0);
    });

    it("refuses paths outside this creation's folder", async () => {
      const owner = await sellerWithBusiness();
      const other = await sellerWithBusiness();
      const id = await draft(owner);
      const otherId = await draft(other);
      const foreign = await uploaded(other, otherId);
      putFile(
        `businesses/${owner.businessId}/creations/${otherId}/${randomUUID()}.jpg`,
        fakeJpeg(),
      );

      for (const path of [
        foreign,
        `businesses/${owner.businessId}/creations/${otherId}/${randomUUID()}.jpg`,
        `businesses/${owner.businessId}/creations/${id}/../${randomUUID()}.jpg`,
        "../../etc/passwd",
        `businesses/${owner.businessId}/${randomUUID()}.jpg`,
      ]) {
        const res = await confirm(owner, id, path);
        expect(res.status, path).toBe(400);
      }
      expect(await prisma.creationImage.count()).toBe(0);
    });

    it("cannot be used by another seller", async () => {
      const owner = await sellerWithBusiness();
      const other = await sellerWithBusiness();
      const id = await draft(owner);
      const path = await uploaded(owner, id);
      expect((await confirm(other, id, path)).status).toBe(404);
    });

    it("refuses to add the same photo twice", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const path = await uploaded(owner, id);
      expect((await confirm(owner, id, path)).status).toBe(201);
      const again = await confirm(owner, id, path);
      expect(again.status).toBe(409);
      expect(await prisma.creationImage.count()).toBe(1);
    });
  });

  describe("the five-photo limit", () => {
    async function withPhotos(owner: Owner, id: string, count: number) {
      for (let i = 0; i < count; i += 1) {
        expect((await confirm(owner, id, await uploaded(owner, id))).status).toBe(201);
      }
    }

    it("allows five photos and refuses a sixth, at upload time and at confirmation", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      await withPhotos(owner, id, 5);

      const sixthTarget = await target(owner, id);
      expect(sixthTarget.status).toBe(409);
      expect(sixthTarget.body.error.code).toBe("IMAGE_LIMIT_REACHED");

      // Even with a file already in storage, confirmation refuses.
      const sneaky = `businesses/${owner.businessId}/creations/${id}/${randomUUID()}.jpg`;
      putFile(sneaky, fakeJpeg());
      const sixth = await confirm(owner, id, sneaky);
      expect(sixth.status).toBe(409);
      expect(await prisma.creationImage.count()).toBe(5);
    });

    it("cannot be beaten by simultaneous confirmations", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      await withPhotos(owner, id, 2);
      const paths = await Promise.all(
        Array.from({ length: 8 }, () => {
          const path = `businesses/${owner.businessId}/creations/${id}/${randomUUID()}.jpg`;
          putFile(path, fakeJpeg());
          return path;
        }),
      );
      const results = await Promise.all(paths.map((path) => confirm(owner, id, path)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      const stored = await prisma.creationImage.findMany({ orderBy: { position: "asc" } });
      expect(stored).toHaveLength(5);
      expect(stored.map((i) => i.position)).toEqual([0, 1, 2, 3, 4]);
    });

    it("is enforced by the database as well", async () => {
      const owner = await sellerWithBusiness();
      const { revisionId } = await buildCreation(prisma, {
        businessId: owner.businessId,
        title: "Full",
        images: Array.from({ length: 5 }, (_, i) => ({
          path: `dev-fixtures/sample-${i + 1}.svg`,
          width: 800,
          height: 800,
        })),
      });
      await expect(
        prisma.creationImage.create({
          data: {
            revisionId,
            path: "dev-fixtures/sample-6.svg",
            position: 5,
            width: 800,
            height: 800,
          },
        }),
      ).rejects.toThrow(/image_limit_reached/);
    });
  });

  describe("reordering and removing", () => {
    async function threePhotos() {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      for (const width of [801, 802, 803])
        await confirm(owner, id, await uploaded(owner, id, fakeJpeg(width, 1000)));
      const view = await request(app).get(`/api/creations/${id}`).set(bearer(owner.seller));
      return { owner, id, images: view.body.revision.images as { id: string; width: number }[] };
    }

    it("puts photos in the requested order, so the first becomes the cover", async () => {
      const { owner, id, images } = await threePhotos();
      const reversed = [...images].reverse().map((i) => i.id);
      const res = await request(app)
        .put(`/api/creations/${id}/images/order`)
        .set(bearer(owner.seller))
        .send({ imageIds: reversed });
      expect(res.status).toBe(200);
      expect(res.body.revision.images.map((i: { width: number }) => i.width)).toEqual([
        803, 802, 801,
      ]);
      const list = await request(app).get("/api/creations").set(bearer(owner.seller));
      expect(list.body.creations[0].cover.width).toBe(803);
    });

    it.each([
      ["a missing photo", (ids: string[]) => ids.slice(1)],
      ["a duplicated photo", (ids: string[]) => [ids[0]!, ids[0]!, ids[1]!]],
      ["an unknown photo", (ids: string[]) => [ids[0]!, ids[1]!, randomUUID()]],
    ])("rejects an order with %s", async (_label, mutate) => {
      const { owner, id, images } = await threePhotos();
      const res = await request(app)
        .put(`/api/creations/${id}/images/order`)
        .set(bearer(owner.seller))
        .send({ imageIds: mutate(images.map((i) => i.id)) });
      expect(res.status).toBe(400);
    });

    it("removes a photo, closes the gap and deletes the file", async () => {
      const { owner, id, images } = await threePhotos();
      const middle = images[1]!;
      const path = (await prisma.creationImage.findUniqueOrThrow({ where: { id: middle.id } }))
        .path;
      const res = await request(app)
        .delete(`/api/creations/${id}/images/${middle.id}`)
        .set(bearer(owner.seller));
      expect(res.status).toBe(200);
      expect(res.body.revision.images.map((i: { width: number }) => i.width)).toEqual([801, 803]);
      expect(files.has(path)).toBe(false);
      const positions = (await prisma.creationImage.findMany({ orderBy: { position: "asc" } })).map(
        (i) => i.position,
      );
      expect(positions).toEqual([0, 1]);
    });

    it("keeps a file that another revision still uses", async () => {
      const owner = await sellerWithBusiness();
      const { creationId, revisionId } = await buildCreation(prisma, {
        businessId: owner.businessId,
        title: "Live",
        images: [{ path: "dev-fixtures/sample-1.svg", width: 800, height: 1000 }],
      });
      // An edit in progress that starts as a copy of the live version.
      const category = await prisma.category.findUniqueOrThrow({ where: { slug: "cakes" } });
      const copy = await prisma.creationRevision.create({
        data: {
          creationId,
          version: 2,
          title: "Live",
          description: "A description that is long enough to count.",
          categoryId: category.id,
          images: {
            create: [{ path: "dev-fixtures/sample-1.svg", position: 0, width: 800, height: 1000 }],
          },
        },
        include: { images: true },
      });
      putFile("dev-fixtures/sample-1.svg", fakeJpeg());
      const res = await request(app)
        .delete(`/api/creations/${creationId}/images/${copy.images[0]!.id}`)
        .set(bearer(owner.seller));
      expect(res.status).toBe(200);
      expect(await prisma.creationImage.count({ where: { revisionId } })).toBe(1);
      expect(files.has("dev-fixtures/sample-1.svg")).toBe(true);
    });

    it("is closed to other sellers and to locked creations", async () => {
      const { owner, id, images } = await threePhotos();
      const other = await sellerWithBusiness();
      expect(
        (
          await request(app)
            .delete(`/api/creations/${id}/images/${images[0]!.id}`)
            .set(bearer(other.seller))
        ).status,
      ).toBe(404);
      await prisma.creation.update({ where: { id }, data: { status: "ARCHIVED" } });
      expect(
        (
          await request(app)
            .delete(`/api/creations/${id}/images/${images[0]!.id}`)
            .set(bearer(owner.seller))
        ).status,
      ).toBe(409);
    });
  });

  describe("private storage", () => {
    it("never exposes images of a creation that has not been approved", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const path = await uploaded(owner, id);
      await confirm(owner, id, path);

      const feed = JSON.stringify((await request(app).get("/api/public/creations")).body);
      expect(feed).not.toContain(path);
      expect((await request(app).get(`/api/public/creations/${id}`)).status).toBe(404);
      // Only the owner's own (authenticated) view carries a short-lived link.
      const own = await request(app).get(`/api/creations/${id}`).set(bearer(owner.seller));
      expect(own.body.revision.images[0].url).toContain(path);
    });
  });

  describe("cleaning up abandoned uploads", () => {
    it("removes old unreferenced files and keeps everything else", async () => {
      const owner = await sellerWithBusiness();
      const id = await draft(owner);
      const folder = `businesses/${owner.businessId}/creations/${id}`;
      const kept = await uploaded(owner, id);
      await confirm(owner, id, kept);

      const oldOrphan = `${folder}/${randomUUID()}.jpg`;
      const recentOrphan = `${folder}/${randomUUID()}.jpg`;
      putFile(oldOrphan, fakeJpeg(), new Date(Date.now() - 3 * 86_400_000));
      putFile(recentOrphan, fakeJpeg(), new Date());

      const result = await cleanupOrphanedUploads(prisma, storage);
      expect(result.removed).toBe(1);
      expect(files.has(oldOrphan)).toBe(false);
      expect(files.has(recentOrphan)).toBe(true);
      expect(files.has(kept)).toBe(true);
      expect((await cleanupOrphanedUploads(prisma, storage)).removed).toBe(0);
    });
  });
});
