import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildBusiness, buildCreation } from "../dev/builders.js";
import { fakePng } from "../test/fake-storage.js";
import { createTestHarness, hasDatabase, resetDatabase, skippedHarness } from "../test/harness.js";
import { escapeHtml, jsonLd, renderRobots, renderSitemap, summarize } from "./render.js";

const WEB = "https://kreatespace.test";
const API = "https://api.kreatespace.test";
const harness = hasDatabase ? createTestHarness({ apiUrl: API }) : skippedHarness();

describe("rendering helpers", () => {
  it("escapes everything that could break out of HTML", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });

  it("keeps structured data from closing its own script tag", () => {
    const text = jsonLd({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("</script>");
    expect(JSON.parse(text).name).toBe("</script><script>alert(1)</script>");
  });

  it("shortens descriptions at a word boundary", () => {
    expect(summarize("short text")).toBe("short text");
    const long = summarize("word ".repeat(100), 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/wor…$/);
  });

  it("writes a sitemap with escaped addresses and a robots file that hides private areas", () => {
    const xml = renderSitemap([
      { loc: "https://x.test/a?b=1&c=2", changefreq: "daily", priority: 1 },
    ]);
    expect(xml).toContain("<loc>https://x.test/a?b=1&amp;c=2</loc>");
    expect(xml).toContain("<priority>1.0</priority>");
    const robots = renderRobots("https://x.test/sitemap.xml");
    for (const path of ["/admin", "/seller", "/account", "/saved", "/login", "/invite/", "/api/"]) {
      expect(robots).toContain(`Disallow: ${path}`);
    }
    expect(robots).toContain("Sitemap: https://x.test/sitemap.xml");
  });
});

describe.skipIf(!hasDatabase)("search engine pages", () => {
  const { app, prisma, putFile } = harness;

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function live() {
    const business = await buildBusiness(prisma, {
      name: "Cakes by Maria",
      slug: "cakes-by-maria",
      county: "Nairobi",
      city: "Westlands",
      websiteUrl: "https://mariacakes.co.ke",
    });
    const cover = "businesses/b1/creations/c1/cover.png";
    putFile(cover, fakePng(800, 1000));
    const creation = await buildCreation(prisma, {
      businessId: business.businessId,
      title: "Floral Wedding Cake",
      description: "A three tier vanilla cake decorated with fresh flowers.",
      occasionSlug: "wedding",
      images: [{ path: cover, width: 800, height: 1000 }],
    });
    return { ...business, ...creation, cover };
  }

  describe("a creation", () => {
    it("describes itself for search engines and link previews", async () => {
      const { creationId } = await live();
      const res = await request(app).get(`/api/public/seo/share/creations/${creationId}`);
      expect(res.status).toBe(200);
      expect(res.type).toBe("text/html");
      expect(res.headers["cache-control"]).toMatch(/public/);
      const html = res.text;
      expect(html).toContain("<title>Floral Wedding Cake by Cakes by Maria — KreateSpace</title>");
      expect(html).toContain(`<link rel="canonical" href="${WEB}/creations/${creationId}">`);
      expect(html).toContain('<meta name="robots" content="index, follow">');
      expect(html).toContain('<meta property="og:type" content="article">');
      expect(html).toContain(`<meta property="og:url" content="${WEB}/creations/${creationId}">`);
      expect(html).toContain(
        `<meta property="og:image" content="${API}/api/public/seo/image/creations/${creationId}">`,
      );
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).toMatch(
        /<meta name="description" content="A three tier vanilla cake[^"]*Westlands, Nairobi\.">/,
      );

      const data = JSON.parse(
        /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!,
      );
      expect(data).toMatchObject({
        "@type": "CreativeWork",
        name: "Floral Wedding Cake",
        creator: { name: "Cakes by Maria", url: `${WEB}/businesses/cakes-by-maria` },
      });
      // No invented prices, ratings or reviews, and no phone number.
      expect(JSON.stringify(data)).not.toMatch(/offers|price|rating|review|telephone|254/i);
      expect(html).not.toMatch(/254712345678|0712 345 678/);
    });

    it("cannot be tricked into running markup by a creation's title or description", async () => {
      const business = await buildBusiness(prisma, {
        name: 'Evil "Bakes" <b>Co</b>',
        slug: "evil-bakes",
      });
      const { creationId } = await buildCreation(prisma, {
        businessId: business.businessId,
        title: `</title><script>alert(1)</script>`,
        description: `"><img src=x onerror=alert(1)> and more words to make a long enough text here`,
      });
      const html = (await request(app).get(`/api/public/seo/share/creations/${creationId}`)).text;
      expect(html).not.toContain("<script>alert(1)");
      expect(html).not.toContain("<img src=x");
      expect(html).not.toMatch(/<b>Co<\/b>/);
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    });

    it("says nothing at all about content that is not public", async () => {
      const { businessId } = await live();
      const pending = await buildCreation(prisma, {
        businessId,
        title: "Secret pending cake",
        status: "PENDING",
      });
      const draft = await buildCreation(prisma, {
        businessId,
        title: "Secret draft cake",
        status: "DRAFT",
      });
      const suspended = await buildBusiness(prisma, { name: "Suspended Co", status: "SUSPENDED" });
      const hidden = await buildCreation(prisma, {
        businessId: suspended.businessId,
        title: "Secret suspended cake",
      });

      for (const id of [pending.creationId, draft.creationId, hidden.creationId, randomUUID()]) {
        const res = await request(app).get(`/api/public/seo/share/creations/${id}`);
        expect(res.status).toBe(404);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.text).toContain('content="noindex, nofollow"');
        expect(res.text).not.toMatch(/Secret|Suspended/);
      }
      expect((await request(app).get("/api/public/seo/share/creations/not-a-uuid")).status).toBe(
        400,
      );
    });
  });

  describe("a business", () => {
    it("describes itself with a local business profile", async () => {
      await live();
      const res = await request(app).get("/api/public/seo/share/businesses/cakes-by-maria");
      expect(res.status).toBe(200);
      const html = res.text;
      expect(html).toContain("<title>Cakes by Maria — Cakes in Westlands — KreateSpace</title>");
      expect(html).toContain(`<link rel="canonical" href="${WEB}/businesses/cakes-by-maria">`);
      expect(html).toContain('<meta property="og:type" content="profile">');
      expect(html).toContain("/api/public/seo/image/creations/");
      const data = JSON.parse(
        /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)![1]!,
      );
      expect(data).toMatchObject({
        "@type": "LocalBusiness",
        name: "Cakes by Maria",
        address: { addressLocality: "Westlands", addressRegion: "Nairobi", addressCountry: "KE" },
        sameAs: ["https://mariacakes.co.ke"],
      });
    });

    it("works for a business with nothing published yet, without an image", async () => {
      await buildBusiness(prisma, { name: "Brand New", slug: "brand-new" });
      const res = await request(app).get("/api/public/seo/share/businesses/brand-new");
      expect(res.status).toBe(200);
      expect(res.text).not.toContain("og:image");
      expect(res.text).toContain('name="twitter:card" content="summary"');
    });

    it("hides businesses that are not public, and bad addresses", async () => {
      await buildBusiness(prisma, { name: "Pending Co", slug: "pending-co", status: "PENDING" });
      await buildBusiness(prisma, {
        name: "Suspended Co",
        slug: "suspended-co",
        status: "SUSPENDED",
      });
      for (const slug of ["pending-co", "suspended-co", "nobody-here"]) {
        const res = await request(app).get(`/api/public/seo/share/businesses/${slug}`);
        expect(res.status, slug).toBe(404);
        expect(res.text).not.toMatch(/Pending Co|Suspended Co/);
      }
      expect((await request(app).get("/api/public/seo/share/businesses/Bad_Slug!")).status).toBe(
        400,
      );
    });
  });

  describe("sitemap and robots", () => {
    it("lists every public page and nothing private", async () => {
      const { creationId, businessId } = await live();
      const pending = await buildCreation(prisma, {
        businessId,
        title: "Hidden",
        status: "PENDING",
      });
      const hiddenBusiness = await buildBusiness(prisma, {
        name: "Hidden Co",
        slug: "hidden-co",
        status: "PENDING",
      });
      const suspended = await buildBusiness(prisma, {
        name: "Suspended Co",
        slug: "suspended-co",
        status: "SUSPENDED",
      });
      const suspendedCreation = await buildCreation(prisma, {
        businessId: suspended.businessId,
        title: "Gone",
      });

      const res = await request(app).get("/api/public/seo/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.type).toBe("application/xml");
      const xml = res.text;
      for (const loc of [WEB, `${WEB}/explore`, `${WEB}/about`, `${WEB}/for-businesses`]) {
        expect(xml).toContain(`<loc>${loc}</loc>`);
      }
      expect(xml).toContain(`<loc>${WEB}/businesses/cakes-by-maria</loc>`);
      expect(xml).toContain(`<loc>${WEB}/creations/${creationId}</loc>`);
      for (const secret of [
        pending.creationId,
        suspendedCreation.creationId,
        hiddenBusiness.slug,
        "suspended-co",
      ]) {
        expect(xml, secret).not.toContain(secret);
      }
      expect(xml).not.toMatch(/\/admin|\/seller|\/saved|\/login/);
    });

    it("serves robots.txt that keeps private areas out of search results", async () => {
      const res = await request(app).get("/api/public/seo/robots.txt");
      expect(res.status).toBe(200);
      expect(res.type).toBe("text/plain");
      expect(res.text).toContain("Disallow: /admin");
      expect(res.text).toContain("Disallow: /seller");
      expect(res.text).toContain(`Sitemap: ${WEB}/sitemap.xml`);
    });
  });

  describe("preview images", () => {
    it("serves the cover photo of a public creation at a stable address", async () => {
      const { creationId } = await live();
      const res = await request(app).get(`/api/public/seo/image/creations/${creationId}`);
      expect(res.status).toBe(200);
      expect(res.type).toBe("image/png");
      expect(res.headers["cache-control"]).toMatch(/public, max-age=86400/);
      expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(Buffer.from(res.body).subarray(0, 4).toString("hex")).toBe("89504e47");
    });

    it("never serves photos of anything that is not public", async () => {
      const { businessId } = await live();
      const secret = "businesses/b1/creations/secret/photo.png";
      putFile(secret, fakePng(800, 1000));
      const draft = await buildCreation(prisma, {
        businessId,
        title: "Draft",
        status: "DRAFT",
        images: [{ path: secret, width: 800, height: 1000 }],
      });
      const suspended = await buildBusiness(prisma, { name: "Suspended Co", status: "SUSPENDED" });
      const gone = await buildCreation(prisma, {
        businessId: suspended.businessId,
        title: "Gone",
        images: [{ path: secret, width: 800, height: 1000 }],
      });
      for (const id of [draft.creationId, gone.creationId, randomUUID()]) {
        expect((await request(app).get(`/api/public/seo/image/creations/${id}`)).status).toBe(404);
      }
    });

    it("refuses to serve a stored file that is not really an image", async () => {
      const business = await buildBusiness(prisma, { name: "Odd Co", slug: "odd-co" });
      putFile("odd/not-an-image.png", Buffer.from("<html>not an image</html>"));
      const { creationId } = await buildCreation(prisma, {
        businessId: business.businessId,
        title: "Odd",
        images: [{ path: "odd/not-an-image.png", width: 800, height: 800 }],
      });
      expect((await request(app).get(`/api/public/seo/image/creations/${creationId}`)).status).toBe(
        404,
      );
    });
  });
});
