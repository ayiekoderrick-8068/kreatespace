import { SignJWT, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { InvalidTokenError, createTokenVerifier } from "./token-verifier.js";

const ISSUER = "https://project.supabase.co/auth/v1";
const secret = new TextEncoder().encode("a-shared-secret-of-at-least-32-bytes!!");

const claims = (alg: string, key: Parameters<SignJWT["sign"]>[0]) =>
  new SignJWT({ email: "maria@example.com" })
    .setProtectedHeader({ alg })
    .setSubject("6f1c1f0e-8d0f-4b1b-9a3e-2f6a5d1c9b11")
    .setIssuer(ISSUER)
    .setAudience("authenticated")
    .setExpirationTime("1h")
    .sign(key);

describe("accepted signing algorithms", () => {
  it("accepts the configured algorithm", async () => {
    const verify = createTokenVerifier(secret, { issuer: ISSUER, algorithms: ["HS256"] });
    expect((await verify(await claims("HS256", secret))).email).toBe("maria@example.com");
  });

  it("rejects a token signed with a different algorithm, even with a valid key", async () => {
    const verify = createTokenVerifier(secret, { issuer: ISSUER, algorithms: ["HS256"] });
    await expect(verify(await claims("HS512", secret))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("rejects unsigned and downgraded tokens", async () => {
    const verify = createTokenVerifier(secret, { issuer: ISSUER, algorithms: ["HS256"] });
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "6f1c1f0e-8d0f-4b1b-9a3e-2f6a5d1c9b11",
        email: "attacker@example.com",
        iss: ISSUER,
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    await expect(verify(`${header}.${payload}.`)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it("a project using asymmetric keys does not accept shared-secret tokens", async () => {
    const pair = await generateKeyPair("ES256");
    const verify = createTokenVerifier(pair.publicKey, {
      issuer: ISSUER,
      algorithms: ["RS256", "ES256", "EdDSA"],
    });
    await expect(verify(await claims("HS256", secret))).rejects.toBeInstanceOf(InvalidTokenError);
    expect((await verify(await claims("ES256", pair.privateKey))).userId).toBeTruthy();
  });
});
