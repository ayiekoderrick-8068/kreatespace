const SITE_NAME = "KreateSpace";

/** Escapes text for use in HTML content and quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON for a `<script type="application/ld+json">`: `<` is escaped so it can't close the tag. */
export function jsonLd(value: unknown): string {
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .split(lineSeparator)
    .join("\\u2028")
    .split(paragraphSeparator)
    .join("\\u2029");
}
export function summarize(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface SharePage {
  title: string;
  description: string;
  /** Absolute address of the page in the web app. */
  url: string;
  /** Absolute address of a preview image, when there is one. */
  image?: string;
  type: "article" | "profile" | "website";
  structuredData?: unknown;
  /** Visible heading and text for crawlers that read the page body. */
  heading: string;
  body: string;
  indexable?: boolean;
}

/**
 * A small, complete HTML page for search engines and link previews. Visitors never see it: the
 * hosting layer sends it only to crawlers, and real browsers get the app.
 */
export function renderSharePage(page: SharePage): string {
  const title = escapeHtml(`${page.title} — ${SITE_NAME}`);
  const description = escapeHtml(page.description);
  const url = escapeHtml(page.url);
  const robots = page.indexable === false ? "noindex, nofollow" : "index, follow";
  const image = page.image ? escapeHtml(page.image) : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${url}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${page.type}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="en_KE">
${image ? `<meta property="og:image" content="${image}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${image}">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
${page.structuredData ? `<script type="application/ld+json">${jsonLd(page.structuredData)}</script>` : ""}
</head>
<body>
<main>
<h1>${escapeHtml(page.heading)}</h1>
<p>${escapeHtml(page.body)}</p>
<p><a href="${url}">View on ${SITE_NAME}</a></p>
</main>
</body>
</html>
`;
}

export interface SitemapEntry {
  loc: string;
  lastmod?: Date;
  changefreq?: "daily" | "weekly" | "monthly";
  priority?: number;
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (entry) =>
        `<url><loc>${escapeHtml(entry.loc)}</loc>${
          entry.lastmod ? `<lastmod>${entry.lastmod.toISOString()}</lastmod>` : ""
        }${entry.changefreq ? `<changefreq>${entry.changefreq}</changefreq>` : ""}${
          entry.priority !== undefined ? `<priority>${entry.priority.toFixed(1)}</priority>` : ""
        }</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Private areas stay out of search engines; everything else may be crawled. */
export function renderRobots(sitemapUrl: string): string {
  const disallowed = [
    "/admin",
    "/seller",
    "/account",
    "/saved",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/invite/",
    "/api/",
  ];
  return [
    "User-agent: *",
    "Allow: /",
    ...disallowed.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");
}
