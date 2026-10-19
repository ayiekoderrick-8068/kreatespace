import { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { HttpError, parseInput } from "../http/errors.js";
import { InvalidImageError, inspectImage } from "../storage/image-validation.js";
import type { MediaStorage } from "../storage/media-storage.js";
import { renderRobots, renderSharePage, renderSitemap } from "./render.js";
import {
  getBusinessSharePage,
  getCreationSharePage,
  getPublicCoverPath,
  listSitemapEntries,
  type SeoUrls,
} from "./service.js";

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(60);

const PAGE_CACHE = "public, max-age=300, stale-while-revalidate=600";

/**
 * Pages and files for search engines and link previews, mounted at /api/public/seo. Only content
 * that is public on the site is ever described here.
 */
export function seoRoutes({
  prisma,
  storage,
  urls,
}: {
  prisma: PrismaClient;
  storage?: MediaStorage;
  urls: SeoUrls;
}): Router {
  const router = Router();

  const html = (res: Response, body: string, status = 200) =>
    res
      .status(status)
      .type("html")
      .set("Cache-Control", status === 200 ? PAGE_CACHE : "no-store")
      .send(body);

  router.get("/share/creations/:id", async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    try {
      html(res, renderSharePage(await getCreationSharePage(prisma, urls, id)));
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
      html(res, notFoundPage(urls.web), 404);
    }
  });

  router.get("/share/businesses/:slug", async (req, res) => {
    const slug = parseInput(slugSchema, req.params.slug);
    try {
      html(res, renderSharePage(await getBusinessSharePage(prisma, urls, slug)));
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
      html(res, notFoundPage(urls.web), 404);
    }
  });

  router.get("/sitemap.xml", async (_req, res) => {
    res
      .type("application/xml")
      .set("Cache-Control", "public, max-age=3600, stale-while-revalidate=7200")
      .send(renderSitemap(await listSitemapEntries(prisma, urls)));
  });

  router.get("/robots.txt", (_req, res) => {
    res
      .type("text/plain")
      .set("Cache-Control", "public, max-age=3600")
      .send(renderRobots(`${urls.web}/sitemap.xml`));
  });

  /**
   * A stable address for a creation's cover photo, so link previews keep working (the storage
   * links expire after an hour). It serves only the first photo of a publicly visible creation.
   */
  router.get("/image/creations/:id", async (req, res) => {
    const id = parseInput(z.uuid(), req.params.id);
    if (!storage) throw new HttpError(404, "NOT_FOUND", "Not found");
    const path = await getPublicCoverPath(prisma, id);
    const bytes = await storage.download(path);
    if (!bytes) throw new HttpError(404, "NOT_FOUND", "Not found");
    let contentType: string;
    try {
      contentType = inspectImage(bytes).contentType;
    } catch (error) {
      if (error instanceof InvalidImageError) throw new HttpError(404, "NOT_FOUND", "Not found");
      throw error;
    }
    res
      .type(contentType)
      .set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
      // Link previews are fetched by other websites' servers.
      .set("Cross-Origin-Resource-Policy", "cross-origin")
      .send(bytes);
  });

  return router;
}

function notFoundPage(web: string): string {
  return renderSharePage({
    title: "Page not found",
    description: "This page isn’t available on KreateSpace.",
    url: web,
    type: "website",
    heading: "Page not found",
    body: "This page isn’t available.",
    indexable: false,
  });
}
