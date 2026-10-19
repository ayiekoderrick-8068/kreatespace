import { describe, expect, it } from "vitest";
import {
  KENYAN_COUNTIES,
  businessDetailsSchema,
  businessSubmissionSchema,
  isSafeWebUrl,
  uploadRequestSchema,
} from "./index.js";

const CATEGORY = "5f7d1a57-0f0e-4a77-8c63-0f2c1f6d3b11";
const BUSINESS = "0b8e8f2a-6a0c-4b8d-9d5b-2f4e1c7a9d10";
const IMAGE = "9c1d7e3a-1f0b-4c52-8a60-7d2e5b1f4a33";

const details = {
  businessName: "Cakes by Maria",
  ownerName: "Maria Wanjiku",
  description: "Custom celebration cakes baked fresh to order in Nairobi.",
  categoryId: CATEGORY,
  county: "Nairobi",
  city: "Westlands",
  whatsappNumber: "0712345678",
};

describe("KENYAN_COUNTIES", () => {
  it("lists all 47 counties", () => {
    expect(new Set(KENYAN_COUNTIES).size).toBe(47);
  });
});

describe("isSafeWebUrl", () => {
  it.each(["https://example.com", "http://shop.example.co.ke/path?x=1"])("accepts %s", (url) => {
    expect(isSafeWebUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.com",
    "example.com",
    "https://localhost",
    "https://user:pass@example.com",
    "data:text/html,<script>",
  ])("rejects %s", (url) => {
    expect(isSafeWebUrl(url)).toBe(false);
  });
});

describe("businessDetailsSchema", () => {
  it("accepts valid details and normalises the WhatsApp number", () => {
    const parsed = businessDetailsSchema.parse(details);
    expect(parsed.whatsappNumber).toBe("+254712345678");
  });

  it("treats the website as optional, including an empty value", () => {
    expect(businessDetailsSchema.safeParse(details).success).toBe(true);
    expect(businessDetailsSchema.safeParse({ ...details, websiteUrl: "" }).success).toBe(true);
  });

  it("rejects unsafe website addresses", () => {
    expect(
      businessDetailsSchema.safeParse({ ...details, websiteUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("reports friendly messages", () => {
    const result = businessDetailsSchema.safeParse({ ...details, description: "short" });
    expect(result.error?.issues[0]?.message).toMatch(/at least 30 characters/);
  });
});

describe("businessSubmissionSchema", () => {
  const complete = {
    ...details,
    portfolioPaths: [`businesses/${BUSINESS}/${IMAGE}.jpg`],
    termsAccepted: true,
    contentAuthorization: true,
  };

  it("accepts a complete submission", () => {
    expect(businessSubmissionSchema.safeParse(complete).success).toBe(true);
  });

  it("requires at least one portfolio photo and no more than six", () => {
    expect(businessSubmissionSchema.safeParse({ ...complete, portfolioPaths: [] }).success).toBe(
      false,
    );
    const seven = Array.from({ length: 7 }, () => complete.portfolioPaths[0]);
    expect(businessSubmissionSchema.safeParse({ ...complete, portfolioPaths: seven }).success).toBe(
      false,
    );
  });

  it("requires both agreements", () => {
    expect(businessSubmissionSchema.safeParse({ ...complete, termsAccepted: false }).success).toBe(
      false,
    );
    expect(
      businessSubmissionSchema.safeParse({ ...complete, contentAuthorization: false }).success,
    ).toBe(false);
  });

  it("rejects storage paths that look like path traversal", () => {
    const bad = { ...complete, portfolioPaths: ["../../etc/passwd"] };
    expect(businessSubmissionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("uploadRequestSchema", () => {
  it("accepts supported image types within the size limit", () => {
    expect(uploadRequestSchema.safeParse({ contentType: "image/webp", size: 1024 }).success).toBe(
      true,
    );
  });

  it.each([
    { contentType: "image/gif", size: 1024 },
    { contentType: "image/png", size: 5 * 1024 * 1024 + 1 },
    { contentType: "image/png", size: -1 },
  ])("rejects %j", (input) => {
    expect(uploadRequestSchema.safeParse(input).success).toBe(false);
  });
});
