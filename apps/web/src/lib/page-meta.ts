import { useEffect } from "react";

export const SITE_NAME = "KreateSpace";
export const DEFAULT_DESCRIPTION =
  "Discover Kenyan creative businesses — cakes, fashion, photography, décor and more — and contact them directly on WhatsApp.";

export interface PageMeta {
  /** The page's own title; the site name is added. */
  title: string;
  description?: string;
  /** Keep the page out of search results (private areas, thin or duplicate pages). */
  noindex?: boolean;
  /** The preferred address of the page, as a path. Defaults to the current path. */
  canonicalPath?: string;
}

/** Shortens text to a search-result description, cutting at a word. */
export function summarize(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function metaTag(name: string): HTMLMetaElement {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = name;
    document.head.appendChild(tag);
  }
  return tag;
}

/** Writes the page's title and search-engine tags into the document head. */
export function applyPageMeta(meta: PageMeta, origin = window.location.origin): void {
  const title = meta.title === SITE_NAME ? SITE_NAME : `${meta.title} — ${SITE_NAME}`;
  document.title = title;
  metaTag("description").content = meta.description ?? DEFAULT_DESCRIPTION;
  metaTag("robots").content = meta.noindex ? "noindex, nofollow" : "index, follow";

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (meta.noindex) {
    // A page kept out of search results should not point search engines anywhere else.
    canonical?.remove();
    return;
  }
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = `${origin}${meta.canonicalPath ?? window.location.pathname}`;
}

/** Sets the page's metadata for as long as the component is shown. Pass null to leave it alone. */
export function usePageMeta(meta: PageMeta | null): void {
  const title = meta?.title;
  const description = meta?.description;
  const noindex = meta?.noindex;
  const canonicalPath = meta?.canonicalPath;
  useEffect(() => {
    if (title === undefined) return;
    applyPageMeta({ title, description, noindex, canonicalPath });
  }, [title, description, noindex, canonicalPath]);
}

const PRIVATE_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/account",
  "/saved",
  "/seller",
  "/admin",
];

/**
 * Metadata for pages that do not load their own content. Creation and business pages return
 * null: they set richer metadata once their data arrives.
 */
export function staticMetaFor(pathname: string, search: string): PageMeta | null {
  if (PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return { title: "Your account", noindex: true };
  }
  if (pathname === "/") return { title: SITE_NAME };
  if (pathname === "/explore") {
    return {
      title: "Explore creations",
      description:
        "Browse cakes, fashion, photography, décor and more from Kenyan creative businesses.",
      // Searches and filter combinations are endless near-duplicates of the main page.
      noindex: search.length > 1,
      canonicalPath: "/explore",
    };
  }
  if (pathname === "/about") {
    return {
      title: "About",
      description:
        "KreateSpace connects customers across Kenya with the creative businesses behind the work they love.",
    };
  }
  if (pathname === "/for-businesses") {
    return {
      title: "For businesses",
      description:
        "Show your work to people looking for it. KreateSpace is invite-only during the pilot for creative businesses in Kenya.",
    };
  }
  if (pathname.startsWith("/creations/") || pathname.startsWith("/businesses/")) return null;
  // The legal documents set their own metadata (they stay unlisted while they are drafts).
  if (["/terms", "/privacy", "/seller-terms"].includes(pathname)) return null;
  // Anything else is a page that does not exist.
  return { title: "Page not found", noindex: true };
}
