import { describe, expect, it } from "vitest";
import {
  cleanText,
  contentHash,
  extractLinks,
  extractPage,
  normalizeTitle,
  parseRobots,
} from "./extract.js";

const page = (body: string, head = "") =>
  `<!doctype html><html><head><title>Site</title>${head}</head><body>${body}</body></html>`;

describe("extractPage", () => {
  it("reads a title, a description and photos from ordinary markup", () => {
    const result = extractPage(
      page(`
        <header><img src="/logo.png" alt="logo"></header>
        <main>
          <h1>Floral Wedding Cake</h1>
          <p>A three tier vanilla cake decorated with fresh flowers, baked to order in Nairobi.</p>
          <img src="/img/cake-1.jpg"><img src="https://shop.test/img/cake-2.webp">
          <img src="/img/tiny.jpg" width="40" height="40">
        </main>
        <footer><p>Copyright notice that is long enough to count as a paragraph here.</p></footer>`),
      "https://shop.test/cakes/floral",
    );
    expect(result).toEqual({
      item: {
        sourceUrl: "https://shop.test/cakes/floral",
        title: "Floral Wedding Cake",
        description:
          "A three tier vanilla cake decorated with fresh flowers, baked to order in Nairobi.",
        imageUrls: ["https://shop.test/img/cake-1.jpg", "https://shop.test/img/cake-2.webp"],
      },
    });
  });

  it("prefers structured product data and social metadata", () => {
    const result = extractPage(
      page(
        "<h1>Ignored heading</h1>",
        `<meta property="og:image" content="/og.jpg">
         <script type="application/ld+json">
           {"@context":"https://schema.org","@type":"Product","name":"Beaded Necklace",
            "description":"Hand beaded necklace made with Maasai beads in Kajiado.",
            "image":["/p1.jpg",{"url":"/p2.jpg"}]}
         </script>`,
      ),
      "https://shop.test/p",
    );
    expect(result).toMatchObject({
      item: {
        title: "Beaded Necklace",
        description: "Hand beaded necklace made with Maasai beads in Kajiado.",
        imageUrls: [
          "https://shop.test/p1.jpg",
          "https://shop.test/p2.jpg",
          "https://shop.test/og.jpg",
        ],
      },
    });
  });

  it("handles JSON-LD graphs and survives broken JSON-LD", () => {
    const graph = extractPage(
      page(
        "",
        `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Product","name":"Tote Bag","description":"A sturdy kitenge tote bag, sewn by hand.","image":"/bag.jpg"}]}</script>`,
      ),
      "https://shop.test/bag",
    );
    expect(graph).toMatchObject({ item: { title: "Tote Bag" } });

    const broken = extractPage(
      page(
        `<h1>Kitenge Dress</h1><p>A bright kitenge dress, tailored to your measurements.</p><img src="/d.jpg">`,
        `<script type="application/ld+json">{ not json</script>`,
      ),
      "https://shop.test/dress",
    );
    expect(broken).toMatchObject({ item: { title: "Kitenge Dress" } });
  });

  it("returns plain text only, never markup or scripts", () => {
    const result = extractPage(
      page(`<main>
        <h1>Cake <script>alert(1)</script><b>Deluxe</b> &lt;img src=x onerror=alert(1)&gt;</h1>
        <p>Rich chocolate cake <style>.x{}</style>with ganache. <a href="javascript:evil()">Click</a> to order today.</p>
        <img src="/c.jpg"><img src="javascript:alert(1)"><img src="data:image/png;base64,AAAA">
      </main>`),
      "https://shop.test/c",
    );
    if (!("item" in result)) throw new Error("expected an item");
    expect(result.item.title).not.toMatch(/[<>]/);
    expect(result.item.title).not.toContain("alert(1)Deluxe");
    expect(result.item.title).toContain("Deluxe");
    expect(result.item.description).not.toContain("<");
    expect(result.item.imageUrls).toEqual(["https://shop.test/c.jpg"]);
  });

  it("limits length and photo count", () => {
    const imgs = Array.from({ length: 9 }, (_, i) => `<img src="/i${i}.jpg">`).join("");
    const result = extractPage(
      page(
        `<main><h1>${"Long title ".repeat(30)}</h1><p>${"Plenty of words here. ".repeat(100)}</p>${imgs}</main>`,
      ),
      "https://shop.test/long",
    );
    if (!("item" in result)) throw new Error("expected an item");
    expect(result.item.title.length).toBeLessThanOrEqual(80);
    expect(result.item.description.length).toBeLessThanOrEqual(1000);
    expect(result.item.imageUrls).toHaveLength(5);
  });

  it("skips pages that cannot become a creation, saying why", () => {
    expect(
      extractPage(
        page("<main><h1>About us</h1><p>Short.</p><img src='/a.jpg'></main>"),
        "https://shop.test/a",
      ),
    ).toEqual({ skipped: "no description" });
    expect(
      extractPage(
        page(
          "<main><h1>Contact</h1><p>Call us any time on our number, we are happy to help.</p></main>",
        ),
        "https://shop.test/c",
      ),
    ).toEqual({ skipped: "no photos" });
    expect(extractPage("", "https://shop.test/")).toEqual({ skipped: "no title" });
  });
});

describe("extractLinks", () => {
  it("returns same-site page links only", () => {
    const html = page(`
      <a href="/cakes">Cakes</a>
      <a href="https://www.shop.test/about#team">About</a>
      <a href="https://shop.test/cakes">Duplicate</a>
      <a href="https://blog.shop.test/post">Subdomain</a>
      <a href="https://other.test/x">Other site</a>
      <a href="https://shop.test.evil.com/x">Look-alike</a>
      <a href="/brochure.pdf">PDF</a>
      <a href="/photo.jpg">Photo</a>
      <a href="mailto:a@b.co">Mail</a>
      <a href="tel:+254700000000">Call</a>
      <a href="javascript:void(0)">JS</a>
      <a href="/wp-admin/">Admin</a>
      <a href="/cart">Cart</a>
      <a href="/">Home</a>`);
    expect(extractLinks(html, "https://shop.test/", "shop.test")).toEqual([
      "https://shop.test/cakes",
      "https://www.shop.test/about",
      "https://blog.shop.test/post",
    ]);
  });
});

describe("parseRobots", () => {
  const robots = `
    User-agent: *
    Disallow: /private
    Disallow: /*.pdf$
    Allow: /private/public

    User-agent: KreateSpaceImporter
    Disallow: /no-importers
  `;

  it("uses the group for this crawler when there is one", () => {
    const allowed = parseRobots(robots, "KreateSpaceImporter/1.0");
    expect(allowed("/no-importers/x")).toBe(false);
    expect(allowed("/private")).toBe(true);
    expect(allowed("/")).toBe(true);
  });

  it("falls back to the wildcard group, longest rule first", () => {
    const allowed = parseRobots(robots, "OtherBot");
    expect(allowed("/private/secret")).toBe(false);
    expect(allowed("/private/public/page")).toBe(true);
    expect(allowed("/catalogue.pdf")).toBe(false);
    expect(allowed("/catalogue.pdf.html")).toBe(true);
    expect(allowed("/cakes")).toBe(true);
  });

  it("allows everything when there is no robots.txt or no matching group", () => {
    expect(parseRobots("", "x")("/anything")).toBe(true);
    expect(parseRobots("User-agent: Googlebot\nDisallow: /", "x")("/anything")).toBe(true);
  });

  it("honours a total ban", () => {
    expect(parseRobots("User-agent: *\nDisallow: /", "x")("/")).toBe(false);
  });
});

describe("duplicate fingerprints", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(normalizeTitle("Floral  Cake!!")).toBe(normalizeTitle("floral cake"));
    expect(contentHash("Floral Cake", "Fresh, flowers.")).toBe(
      contentHash("floral cake", "fresh  flowers"),
    );
    expect(contentHash("Floral Cake", "Fresh flowers")).not.toBe(
      contentHash("Floral Cake", "Fresh fruit"),
    );
  });

  it("cleans control characters and whitespace", () => {
    expect(cleanText("  a\u0000b\n\n c​ d ")).toBe("a b c d");
    expect(cleanText(undefined)).toBe("");
  });
});
