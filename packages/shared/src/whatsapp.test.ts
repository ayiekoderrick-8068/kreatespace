import { describe, expect, it } from "vitest";
import { buildWhatsAppLink, profileInquiryMessage } from "./index.js";

describe("buildWhatsAppLink", () => {
  it("builds a wa.me link with a digits-only number and an encoded message", () => {
    const link = buildWhatsAppLink("+254712345678", "Hello Cakes & Co! Is Sat free?");
    expect(link).toBe(
      "https://wa.me/254712345678?text=Hello%20Cakes%20%26%20Co!%20Is%20Sat%20free%3F",
    );
  });

  it("accepts local formats", () => {
    expect(buildWhatsAppLink("0712 345 678", "Hi")).toBe("https://wa.me/254712345678?text=Hi");
  });

  it("returns null for invalid numbers", () => {
    expect(buildWhatsAppLink("12345", "Hi")).toBeNull();
    expect(buildWhatsAppLink("+1 415 555 0100", "Hi")).toBeNull();
  });

  it("neutralises characters that could break out of the query string", () => {
    const link = buildWhatsAppLink("0712345678", "a&text=evil#frag\nnew line")!;
    expect(link).not.toContain("&text=evil");
    expect(link).not.toContain("#");
    expect(link).not.toContain("\n");
  });
});

describe("profileInquiryMessage", () => {
  it("names the business and KreateSpace", () => {
    expect(profileInquiryMessage("Cakes by Maria")).toMatch(
      /^Hello Cakes by Maria! I found your business on KreateSpace/,
    );
  });
});
