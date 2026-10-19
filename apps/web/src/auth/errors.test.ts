import { describe, expect, it } from "vitest";
import { authErrorMessage, isAlreadyRegistered } from "./errors";

describe("authErrorMessage", () => {
  it("passes nothing through when there is no error", () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage(undefined)).toBeNull();
  });

  it("gives a wrong password and an unknown email the same message", () => {
    expect(authErrorMessage({ message: "Invalid login credentials" })).toBe(
      "Invalid login credentials",
    );
  });

  it("explains unverified emails, rate limits and expired links in plain words", () => {
    expect(authErrorMessage({ message: "Email not confirmed" })).toMatch(/verify your email/);
    expect(authErrorMessage({ message: "x", status: 429 })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ message: "email rate limit exceeded" })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ message: "Email link is invalid or has expired" })).toMatch(
      /expired/,
    );
  });

  it("keeps useful password guidance", () => {
    const message = "Password should be at least 8 characters.";
    expect(authErrorMessage({ message })).toBe(message);
  });

  it("hides anything technical or unknown behind a generic message", () => {
    for (const message of [
      "FetchError: connect ECONNREFUSED 10.0.0.5:5432",
      "AuthRetryableFetchError",
      "JWT secret mismatch at /auth/v1/token",
      "",
    ]) {
      expect(authErrorMessage({ message })).toBe("Something went wrong. Please try again.");
    }
    expect(authErrorMessage({})).toBe("Something went wrong. Please try again.");
  });
});

describe("isAlreadyRegistered", () => {
  it("recognises an existing account by code or message", () => {
    expect(isAlreadyRegistered({ code: "user_already_exists" })).toBe(true);
    expect(isAlreadyRegistered({ message: "User already registered" })).toBe(true);
    expect(isAlreadyRegistered({ message: "A user has already been registered" })).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isAlreadyRegistered({ message: "Password too short" })).toBe(false);
    expect(isAlreadyRegistered(null)).toBe(false);
  });
});
