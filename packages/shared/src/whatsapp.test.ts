import { describe, expect, it } from "vitest";
import {
  MAX_WHATSAPP_MESSAGE_LENGTH,
  buildQuoteMessage,
  buildWhatsAppLink,
  creationInquiryMessage,
  inquiryEventSchema,
  normalizePhoneNumber,
  packageInquiryMessage,
  profileInquiryMessage,
  quoteRequestSchema,
  supportsQuoteRequests,
  whatsappNumberSchema,
} from "./index.js";

describe("normalizePhoneNumber", () => {
  it.each([
    ["0712 345 678", "+254712345678"],
    ["254712345678", "+254712345678"],
    ["+254 712-345-678", "+254712345678"],
    ["0112345678", "+254112345678"],
    ["+44 7700 900123", "+447700900123"],
    ["0044 7700 900123", "+447700900123"],
    ["+1 (415) 555-0100", "+14155550100"],
    ["+255 712 345 678", "+255712345678"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "12345",
    "07123456",
    "0212345678",
    "+254212345678", // looks Kenyan but isn't a valid Kenyan mobile
    "+0123456789",
    "+1234",
    "+12345678901234567",
    "+44 7700 abc",
    "447700900123", // international without + or 00 is ambiguous, so it's refused
  ])("rejects %s", (input) => {
    expect(normalizePhoneNumber(input)).toBeNull();
  });

  it("validates through the schema with a friendly message", () => {
    expect(whatsappNumberSchema.parse("0712345678")).toBe("+254712345678");
    const bad = whatsappNumberSchema.safeParse("12345");
    expect(bad.error?.issues[0]?.message).toMatch(/valid WhatsApp number/);
  });
});

describe("buildWhatsAppLink", () => {
  it("builds the official wa.me link with a digits-only number and an encoded message", () => {
    expect(buildWhatsAppLink("+254712345678", "Hello Cakes & Co! Is Sat free?")).toBe(
      "https://wa.me/254712345678?text=Hello%20Cakes%20%26%20Co!%20Is%20Sat%20free%3F",
    );
  });

  it("opens the intended number for local, Kenyan and international formats", () => {
    expect(buildWhatsAppLink("0712 345 678", "Hi")).toBe("https://wa.me/254712345678?text=Hi");
    expect(buildWhatsAppLink("+44 7700 900123", "Hi")).toBe("https://wa.me/447700900123?text=Hi");
  });

  it("returns null for invalid numbers so the action can be hidden", () => {
    expect(buildWhatsAppLink("12345", "Hi")).toBeNull();
    expect(buildWhatsAppLink("", "Hi")).toBeNull();
  });

  it("neutralises characters that could break out of the query string", () => {
    const link = buildWhatsAppLink("0712345678", "a&text=evil#frag?x=1 new\nline")!;
    expect(link.match(/\?/g)).toHaveLength(1);
    expect(link).not.toMatch(/&text=evil/);
    expect(link).not.toContain("#");
    expect(link).toContain("%0A"); // real line breaks are kept, encoded
  });

  it("drops control characters and keeps emoji and Swahili text intact", () => {
    const link = buildWhatsAppLink("0712345678", "Habari\u0000\u0007 😊 asante")!;
    expect(decodeURIComponent(link.split("text=")[1]!)).toBe("Habari 😊 asante");
  });

  it("keeps very long messages within a safe length", () => {
    const link = buildWhatsAppLink("0712345678", "x".repeat(5000))!;
    const text = decodeURIComponent(link.split("text=")[1]!);
    expect(text.length).toBeLessThanOrEqual(MAX_WHATSAPP_MESSAGE_LENGTH);
    expect(text.endsWith("…")).toBe(true);
  });

  it("never alters the destination, whatever the message says", () => {
    const link = buildWhatsAppLink("0712345678", "+254700000000 https://wa.me/254799999999")!;
    expect(link.startsWith("https://wa.me/254712345678?text=")).toBe(true);
  });
});

describe("message templates", () => {
  it("greets the business and names the creation and its page", () => {
    expect(
      creationInquiryMessage(
        "Cakes by Maria",
        "Floral Birthday Cake",
        "https://kreate.example/creations/1",
      ),
    ).toBe(
      "Hello Cakes by Maria! I found your Floral Birthday Cake on KreateSpace. I'm interested in it. Could you please share the price, availability, and ordering details?\nhttps://kreate.example/creations/1",
    );
  });

  it("covers packages and profiles", () => {
    expect(packageInquiryMessage("Lens Works", "Wedding Package")).toMatch(
      /^Hello Lens Works! I found your Wedding Package on KreateSpace\./,
    );
    expect(profileInquiryMessage("Cakes by Maria")).toMatch(
      /^Hello Cakes by Maria! I found your business/,
    );
  });
});

describe("quote requests", () => {
  const valid = {
    serviceType: "Wedding photography",
    eventDate: "2099-12-12",
    eventLocation: "Nairobi",
    description: "Full-day coverage for about 150 guests.",
  };

  it("accepts a complete request, with the name and date optional", () => {
    expect(quoteRequestSchema.safeParse(valid).success).toBe(true);
    const noDate: Record<string, unknown> = { ...valid };
    delete noDate.eventDate;
    expect(quoteRequestSchema.safeParse(noDate).success).toBe(true);
    expect(quoteRequestSchema.safeParse({ ...valid, eventDate: "" }).success).toBe(true);
  });

  it.each([
    [{ serviceType: "" }, "serviceType"],
    [{ eventLocation: "" }, "eventLocation"],
    [{ description: "short" }, "description"],
    [{ eventDate: "12/12/2099" }, "eventDate"],
    [{ eventDate: "2001-01-01" }, "eventDate"],
    [{ description: "x".repeat(501) }, "description"],
    [{ customerName: "n".repeat(61) }, "customerName"],
  ])("rejects %j", (override, field) => {
    const result = quoteRequestSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path[0]).toBe(field);
  });

  it("prepares a readable message and skips empty lines", () => {
    const quote = quoteRequestSchema.parse({ ...valid, customerName: "Joy" });
    const message = buildQuoteMessage({
      businessName: "Lens Works",
      subject: "Garden Wedding Photography",
      quote,
      pageUrl: "https://kreate.example/creations/1",
    });
    expect(message.split("\n")).toEqual([
      "Hello Lens Works! I found you on KreateSpace and I'd like a quote for Wedding photography.",
      "I was looking at: Garden Wedding Photography",
      "Event date: 12 December 2099",
      "Location: Nairobi",
      "Details: Full-day coverage for about 150 guests.",
      "Thank you, Joy",
      "https://kreate.example/creations/1",
    ]);
    const minimal = buildQuoteMessage({
      businessName: "Lens Works",
      quote: quoteRequestSchema.parse({ ...valid, eventDate: "" }),
    });
    expect(minimal).not.toMatch(/Event date|Thank you|I was looking at/);
  });

  it("applies only to photography and event decoration", () => {
    expect(supportsQuoteRequests("photography")).toBe(true);
    expect(supportsQuoteRequests("event-decor")).toBe(true);
    for (const slug of ["cakes", "fashion", "beauty", "flowers", "creative-gifts", "other"]) {
      expect(supportsQuoteRequests(slug)).toBe(false);
    }
  });
});

describe("inquiryEventSchema", () => {
  const id = "5f7d1a57-0f0e-4a77-8c63-0f2c1f6d3b11";

  it.each([
    { type: "CREATION_VIEW", creationId: id },
    { type: "BUSINESS_VIEW", businessSlug: "cakes-by-maria" },
    {
      type: "WHATSAPP_CLICK",
      businessSlug: "cakes-by-maria",
      creationId: id,
      source: "creation_page",
    },
    { type: "WEBSITE_CLICK", businessSlug: "cakes-by-maria", source: "business_page" },
    { type: "WHATSAPP_CLICK", businessSlug: "cakes-by-maria", packageId: id, source: "package" },
  ])("accepts %j", (event) => {
    expect(inquiryEventSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    { type: "CREATION_VIEW" },
    { type: "BUSINESS_VIEW", creationId: id },
    { type: "WHATSAPP_CLICK" },
    { type: "MESSAGE_SENT", businessSlug: "x" },
    { type: "BUSINESS_VIEW", businessSlug: "Bad Slug!" },
    { type: "BUSINESS_VIEW", businessSlug: "ok", source: "somewhere" },
  ])("rejects %j", (event) => {
    expect(inquiryEventSchema.safeParse(event).success).toBe(false);
  });

  it("carries no personal fields: unknown keys are dropped", () => {
    const parsed = inquiryEventSchema.parse({
      type: "BUSINESS_VIEW",
      businessSlug: "cakes-by-maria",
      phone: "0712345678",
      message: "Hello there",
      email: "a@b.co",
    });
    expect(Object.keys(parsed)).toEqual(["type", "businessSlug"]);
  });
});
