import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  kenyanPhoneSchema,
  loginSchema,
  normalizeKenyanPhone,
  registerSchema,
  resetPasswordSchema,
  toWhatsAppNumber,
  userRoleSchema,
} from "./index.js";

describe("normalizeKenyanPhone", () => {
  it.each([
    ["0712345678", "+254712345678"],
    ["0712 345 678", "+254712345678"],
    ["712345678", "+254712345678"],
    ["254712345678", "+254712345678"],
    ["+254 712-345-678", "+254712345678"],
    ["0112345678", "+254112345678"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "071234567",
    "07123456789",
    "0212345678",
    "+255712345678",
    "+1 415 555 0100",
    "+254+712345678",
  ])("rejects %s", (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });

  it("produces digits-only numbers for wa.me links", () => {
    expect(toWhatsAppNumber("+254712345678")).toBe("254712345678");
  });
});

describe("kenyanPhoneSchema", () => {
  it("transforms valid input to E.164", () => {
    expect(kenyanPhoneSchema.parse("0712345678")).toBe("+254712345678");
  });

  it("reports a friendly error for invalid input", () => {
    const result = kenyanPhoneSchema.safeParse("12345");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter a valid Kenyan mobile number");
  });
});

describe("registerSchema", () => {
  const valid = {
    fullName: "Maria Wanjiku",
    email: "  Maria@Example.com ",
    password: "bakery2024",
    confirmPassword: "bakery2024",
  };

  it("accepts valid input and normalises the email", () => {
    const result = registerSchema.parse(valid);
    expect(result.email).toBe("maria@example.com");
  });

  it("rejects mismatched passwords on the confirmation field", () => {
    const result = registerSchema.safeParse({ ...valid, confirmPassword: "different1" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });

  it.each(["short1", "allletters", "12345678"])("rejects weak password %s", (password) => {
    expect(
      registerSchema.safeParse({ ...valid, password, confirmPassword: password }).success,
    ).toBe(false);
  });

  it("rejects invalid emails", () => {
    expect(registerSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });
});

describe("other auth schemas", () => {
  it("requires a password to log in but does not enforce strength", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("validates the forgot-password email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
  });

  it("applies strength rules when resetting a password", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "weak", confirmPassword: "weak" }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ password: "strong123", confirmPassword: "strong123" })
        .success,
    ).toBe(true);
  });
});

describe("userRoleSchema", () => {
  it("only allows known roles", () => {
    expect(userRoleSchema.safeParse("ADMIN").success).toBe(true);
    expect(userRoleSchema.safeParse("ROOT").success).toBe(false);
  });
});
