import { createHash } from "node:crypto";
import type { BrowserContext, Route } from "@playwright/test";
import { SignJWT, decodeJwt } from "jose";
import { JWT_SECRET, STORAGE_BUCKET, SUPABASE_ISSUER, SUPABASE_URL } from "./env.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

/** The only password the stand-in sign-in accepts. */
export const MOCK_PASSWORD = "password123";

/** What the browser asked the stand-in sign-in service to do, for tests to inspect. */
export const authRequests: { signups: unknown[]; recoveries: unknown[] } = {
  signups: [],
  recoveries: [],
};

/** The only code the stand-in authenticator accepts. */
export const TEST_TOTP_CODE = "123456";

/** A stable UUID for an email address, so the same person keeps the same identity. */
export function userIdFor(email: string): string {
  const hex = createHash("sha1").update(email).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Each person's authenticator, kept for the whole test run like a real account would. */
const factors = new Map<string, { id: string; verified: boolean }>();

const factorFor = (email: string) => factors.get(email);
const factorIdFor = (email: string) => `factor-${userIdFor(email).slice(0, 8)}`;

/**
 * A token for calling the API directly from a test, as someone who has completed every step (so
 * administrators can be used to set data up without clicking through two-step verification).
 */
export async function accessTokenFor(email: string): Promise<string> {
  return (await sessionFor(email, "aal2")).access_token;
}

/** Forget a person's authenticator, so a test can start from "never set up". */
export function forgetAuthenticator(email: string): void {
  factors.delete(email.toLowerCase());
}

async function sessionFor(email: string, aal: "aal1" | "aal2") {
  const id = userIdFor(email);
  const expiresIn = 3600;
  const now = Math.floor(Date.now() / 1000);
  const amr =
    aal === "aal2"
      ? [
          { method: "password", timestamp: now },
          { method: "totp", timestamp: now },
        ]
      : [{ method: "password", timestamp: now }];
  const accessToken = await new SignJWT({ email, role: "authenticated", aal, amr })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setIssuer(SUPABASE_ISSUER)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(new TextEncoder().encode(JWT_SECRET));

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    refresh_token: `refresh-${id}`,
    user: userFor(email),
  };
}

function userFor(email: string) {
  const factor = factorFor(email);
  return {
    id: userIdFor(email),
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
    factors: factor
      ? [
          {
            id: factor.id,
            factor_type: "totp",
            friendly_name: "Authenticator app",
            status: factor.verified ? "verified" : "unverified",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]
      : [],
  };
}

function emailFromAuthorization(header: string | undefined): string | null {
  const token = header?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const email = decodeJwt(token).email;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

/**
 * Answers the browser's Supabase requests (password sign-in, two-step verification, sign-out and
 * signed uploads) without any network access, so the real app can be driven end to end.
 *
 * Two-step verification behaves like Supabase: a password gives a session at the weaker level;
 * enrolling and verifying the code TEST_TOTP_CODE gives a session at the stronger level.
 */
export async function mockSupabase(context: BrowserContext): Promise<void> {
  await context.route(`${SUPABASE_URL}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }

    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const { email, password } = request.postDataJSON() as { email: string; password: string };
      if (password !== MOCK_PASSWORD) {
        // Supabase answers a wrong password and an unknown address in exactly the same way.
        return route.fulfill({
          status: 400,
          headers: CORS,
          json: {
            code: 400,
            error_code: "invalid_credentials",
            msg: "Invalid login credentials",
            message: "Invalid login credentials",
          },
        });
      }
      return route.fulfill({
        status: 200,
        headers: CORS,
        json: await sessionFor(email.toLowerCase(), "aal1"),
      });
    }

    if (url.pathname === "/auth/v1/user" && request.method() === "GET") {
      const email = emailFromAuthorization(request.headers().authorization);
      if (!email)
        return route.fulfill({ status: 401, headers: CORS, json: { message: "no session" } });
      return route.fulfill({ status: 200, headers: CORS, json: userFor(email) });
    }

    if (url.pathname === "/auth/v1/factors" && request.method() === "POST") {
      const email = emailFromAuthorization(request.headers().authorization);
      if (!email)
        return route.fulfill({ status: 401, headers: CORS, json: { message: "no session" } });
      const id = factorIdFor(email);
      factors.set(email, { id, verified: false });
      return route.fulfill({
        status: 200,
        headers: CORS,
        json: {
          id,
          type: "totp",
          friendly_name: "Authenticator app",
          totp: {
            qr_code:
              '<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176"><rect width="176" height="176" fill="#fff"/></svg>',
            secret: "JBSWY3DPEHPK3PXP",
            uri: `otpauth://totp/KreateSpace:${email}?secret=JBSWY3DPEHPK3PXP`,
          },
        },
      });
    }

    const challenge = url.pathname.match(/^\/auth\/v1\/factors\/([^/]+)\/challenge$/);
    if (challenge && request.method() === "POST") {
      return route.fulfill({
        status: 200,
        headers: CORS,
        json: { id: "challenge-1", type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 },
      });
    }

    const verify = url.pathname.match(/^\/auth\/v1\/factors\/([^/]+)\/verify$/);
    if (verify && request.method() === "POST") {
      const email = emailFromAuthorization(request.headers().authorization);
      const { code } = request.postDataJSON() as { code: string };
      if (!email || code !== TEST_TOTP_CODE) {
        return route.fulfill({
          status: 400,
          headers: CORS,
          json: { code: "mfa_verification_failed", message: "Invalid TOTP code entered" },
        });
      }
      factors.set(email, { id: verify[1]!, verified: true });
      return route.fulfill({ status: 200, headers: CORS, json: await sessionFor(email, "aal2") });
    }

    const removal = url.pathname.match(/^\/auth\/v1\/factors\/([^/]+)$/);
    if (removal && request.method() === "DELETE") {
      const email = emailFromAuthorization(request.headers().authorization);
      if (email && factors.get(email)?.id === removal[1]) factors.delete(email);
      return route.fulfill({ status: 200, headers: CORS, json: { id: removal[1] } });
    }

    if (url.pathname === "/auth/v1/signup" && request.method() === "POST") {
      const body = request.postDataJSON() as { email: string };
      authRequests.signups.push(body);
      // An address that already has an account gets the error the app must hide from visitors.
      if (body.email.startsWith("existing-")) {
        return route.fulfill({
          status: 422,
          headers: CORS,
          json: {
            code: 422,
            error_code: "user_already_exists",
            msg: "User already registered",
            message: "User already registered",
          },
        });
      }
      // A new account that still has to verify its address comes back without a session.
      return route.fulfill({
        status: 200,
        headers: CORS,
        json: {
          ...userFor(body.email.toLowerCase()),
          confirmation_sent_at: new Date().toISOString(),
        },
      });
    }

    if (url.pathname === "/auth/v1/recover" && request.method() === "POST") {
      authRequests.recoveries.push({
        ...(request.postDataJSON() as object),
        redirectTo: url.searchParams.get("redirect_to"),
      });
      // The same answer whether or not the address has an account.
      return route.fulfill({ status: 200, headers: CORS, json: {} });
    }

    if (url.pathname === "/auth/v1/logout") {
      return route.fulfill({ status: 204, headers: CORS });
    }

    if (url.pathname.startsWith(`/storage/v1/object/upload/sign/${STORAGE_BUCKET}/`)) {
      return route.fulfill({
        status: 200,
        headers: CORS,
        json: { Key: `${STORAGE_BUCKET}/uploaded` },
      });
    }

    return route.fulfill({ status: 404, headers: CORS, json: { message: "not mocked" } });
  });
}
