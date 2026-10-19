import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { MAX_IMAGES_PER_CREATION } from "@kreatespace/shared";
import { hostMatchesDomain } from "./net-guard.js";

export interface ExtractedItem {
  sourceUrl: string;
  title: string;
  description: string;
  imageUrls: string[];
}

export type Extraction = { item: ExtractedItem } | { skipped: string };

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 1000;
const DESCRIPTION_MIN = 20;

/** Control and invisible characters that have no place in a title or description. */
function isJunkCharacter(code: number): boolean {
  return (
    code <= 8 ||
    code === 11 ||
    code === 12 ||
    (code >= 14 && code <= 31) ||
    (code >= 127 && code <= 159) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff
  );
}

/** Plain text only: tags are gone, control characters removed and whitespace collapsed. */
export function cleanText(value: string | undefined | null): string {
  return (
    Array.from(value ?? "", (char) => (isJunkCharacter(char.codePointAt(0)!) ? " " : char))
      .join("")
      // Angle brackets can only come from decoded entities; stored text never looks like markup.
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Resolves a (possibly relative) reference to an absolute http(s) URL, or null. */
export function resolveHttpUrl(reference: string | undefined, base: string): string | null {
  if (!reference) return null;
  try {
    const url = new URL(reference.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Collects `image` values from JSON-LD, which may be a string, a list or an ImageObject. */
function jsonLdImages(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonLdImages);
  if (value && typeof value === "object") {
    const url =
      (value as { url?: unknown; contentUrl?: unknown }).url ??
      (value as { contentUrl?: unknown }).contentUrl;
    return typeof url === "string" ? [url] : [];
  }
  return [];
}

function jsonLdNodes(raw: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const graph = (entry as { "@graph"?: unknown })["@graph"];
      return Array.isArray(graph)
        ? (graph.filter((n) => n && typeof n === "object") as Record<string, unknown>[])
        : [entry as Record<string, unknown>];
    });
  } catch {
    return [];
  }
}

const NOISE_IMAGE = /(logo|icon|sprite|avatar|favicon|pixel|spacer|badge|banner-ad|tracking)/i;

/**
 * Turns one page into a candidate creation: a title, a description and up to five photos.
 * Pages without all three are skipped with a reason. The result is only ever a proposal for a
 * person to review; nothing here is published.
 */
export function extractPage(html: string, pageUrl: string): Extraction {
  const $ = cheerio.load(html);

  const product = $('script[type="application/ld+json"]')
    .toArray()
    .flatMap((el) => jsonLdNodes($(el).text()))
    .find((node) => {
      const type = node["@type"];
      return ["Product", "Service", "CreativeWork", "Article"].some((t) =>
        Array.isArray(type) ? type.includes(t) : type === t,
      );
    });

  const meta = (name: string) =>
    $(`meta[property="${name}"], meta[name="${name}"]`).first().attr("content");

  // Scripts and styles are never text a visitor reads, so they go before any text is read.
  $("script, style, noscript, template, iframe, svg").remove();

  const title =
    cleanText(typeof product?.name === "string" ? product.name : undefined) ||
    cleanText(meta("og:title")) ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").first().text());

  // Page furniture is not content: drop it before reading body text or images.
  $("nav, header, footer, aside, form").remove();

  let description = cleanText(
    typeof product?.description === "string"
      ? product.description
      : (meta("og:description") ?? meta("description")),
  );
  if (description.length < DESCRIPTION_MIN) {
    const paragraphs = $("main p, article p, p")
      .toArray()
      .map((el) => cleanText($(el).text()))
      .filter((text) => text.length >= 30);
    description = cleanText(paragraphs.slice(0, 3).join(" "));
  }

  const candidates: (string | undefined)[] = [
    ...(product ? jsonLdImages(product.image) : []),
    meta("og:image"),
  ];
  const scope = $("main, article").length > 0 ? $("main, article").find("img") : $("img");
  scope.each((_, el) => {
    const img = $(el);
    const width = Number(img.attr("width"));
    const height = Number(img.attr("height"));
    if (
      (Number.isFinite(width) && width > 0 && width < 120) ||
      (Number.isFinite(height) && height > 0 && height < 120)
    ) {
      return;
    }
    candidates.push(img.attr("src") ?? img.attr("data-src"));
  });

  const imageUrls: string[] = [];
  for (const candidate of candidates) {
    const resolved = resolveHttpUrl(candidate, pageUrl);
    if (!resolved || NOISE_IMAGE.test(new URL(resolved).pathname)) continue;
    if (!imageUrls.includes(resolved)) imageUrls.push(resolved);
    if (imageUrls.length >= MAX_IMAGES_PER_CREATION) break;
  }

  if (title.length < 3) return { skipped: "no title" };
  if (description.length < DESCRIPTION_MIN) return { skipped: "no description" };
  if (imageUrls.length === 0) return { skipped: "no photos" };

  const sourceUrl = resolveHttpUrl(pageUrl, pageUrl)!;
  return {
    item: {
      sourceUrl,
      title: truncate(title, TITLE_MAX),
      description: truncate(description, DESCRIPTION_MAX),
      imageUrls,
    },
  };
}

const SKIPPED_EXTENSIONS =
  /\.(?:pdf|zip|rar|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|svg|ico|mp[34]|avi|mov|css|js|json|xml|txt)$/i;

/** Same-site page links on a page, in order, without duplicates, fragments or downloads. */
export function extractLinks(html: string, pageUrl: string, domain: string): string[] {
  const $ = cheerio.load(html);
  const base = resolveHttpUrl(pageUrl, pageUrl);
  const seen = new Set<string>(base ? [base] : []);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const resolved = resolveHttpUrl($(el).attr("href"), pageUrl);
    if (!resolved) return;
    const url = new URL(resolved);
    if (!hostMatchesDomain(url.hostname, domain)) return;
    if (SKIPPED_EXTENSIONS.test(url.pathname)) return;
    if (/^\/(?:wp-admin|wp-login|admin|login|cart|checkout|account)\b/i.test(url.pathname)) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    links.push(resolved);
  });
  return links;
}

// --- robots.txt -----------------------------------------------------------------------------------

/** Builds a path check from a robots.txt body for the given crawler name. */
export function parseRobots(text: string, agent: string): (path: string) => boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current && (field === "allow" || field === "disallow") && value) {
      current.rules.push({ allow: field === "allow", pattern: value });
    }
  }

  const name = agent.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && name.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!group) return () => true;

  const compiled = group.rules.map((rule) => ({
    allow: rule.allow,
    length: rule.pattern.length,
    regex: new RegExp(
      "^" +
        rule.pattern
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\\\$$/, "$"),
    ),
  }));
  return (path) => {
    // The longest matching rule wins; on a tie, allowing wins.
    let best: { allow: boolean; length: number } | null = null;
    for (const rule of compiled) {
      if (!rule.regex.test(path)) continue;
      if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) {
        best = rule;
      }
    }
    return best ? best.allow : true;
  };
}

// --- duplicates -----------------------------------------------------------------------------------

/** Lower-case letters and digits only, so "Floral Cake!" and "floral  cake" compare equal. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A fingerprint of a creation's words, independent of casing, punctuation and spacing. */
export function contentHash(title: string, description: string): string {
  return createHash("sha256")
    .update(`${normalizeTitle(title)}\n${normalizeTitle(description)}`)
    .digest("hex");
}
