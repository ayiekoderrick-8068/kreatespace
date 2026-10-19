import { createRemoteJWKSet, jwtVerify, type CryptoKey, type JWTVerifyGetKey } from "jose";

export interface VerifiedToken {
  userId: string;
  email: string;
  fullName?: string;
}

export type TokenVerifier = (token: string) => Promise<VerifiedToken>;

type VerificationKey = Uint8Array | CryptoKey | JWTVerifyGetKey;

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/** Verifies a Supabase access token with the given key and maps its claims. */
export function createTokenVerifier(
  key: VerificationKey,
  options: { issuer: string; algorithms?: string[] },
): TokenVerifier {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, key as JWTVerifyGetKey, {
        issuer: options.issuer,
        audience: "authenticated",
        // Only the signing algorithms this project uses; never whatever the token asks for.
        algorithms: options.algorithms,
      });
      if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
        throw new InvalidTokenError("Token is missing required claims");
      }
      const metadata = payload.user_metadata as { full_name?: unknown } | undefined;
      return {
        userId: payload.sub,
        email: payload.email.toLowerCase(),
        fullName: typeof metadata?.full_name === "string" ? metadata.full_name : undefined,
      };
    } catch (error) {
      if (error instanceof InvalidTokenError) throw error;
      throw new InvalidTokenError();
    }
  };
}

/**
 * Builds a verifier for a Supabase project. Projects with asymmetric signing keys are verified
 * against the project's JWKS; the legacy shared secret is supported when provided.
 */
export function createSupabaseTokenVerifier(config: {
  supabaseUrl: string;
  jwtSecret?: string;
}): TokenVerifier {
  const baseUrl = config.supabaseUrl.replace(/\/+$/, "");
  const issuer = `${baseUrl}/auth/v1`;
  const key: VerificationKey = config.jwtSecret
    ? new TextEncoder().encode(config.jwtSecret)
    : createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return createTokenVerifier(key, {
    issuer,
    algorithms: config.jwtSecret ? ["HS256"] : ["RS256", "ES256", "EdDSA"],
  });
}
