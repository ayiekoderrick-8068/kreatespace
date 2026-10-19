import { createHash } from "node:crypto";
import type { BrowserContext, Route } from "@playwright/test";
import { SignJWT } from "jose";
import { JWT_SECRET, STORAGE_BUCKET, SUPABASE_ISSUER, SUPABASE_URL } from "./env.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

/** A stable UUID for an email address, so the same person keeps the same identity. */
export function userIdFor(email: string): string {
  const hex = createHash("sha1").update(email).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function accessTokenFor(email: string): Promise<string> {
  return (await sessionFor(email)).access_token;
}

async function sessionFor(email: string) {
  const id = userIdFor(email);
  const expiresIn = 3600;
  const accessToken = await new SignJWT({ email, role: "authenticated" })
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
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: `refresh-${id}`,
    user: {
      id,
      aud: "authenticated",
      role: "authenticated",
      email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

/**
 * Answers the browser's Supabase requests (password sign-in, sign-out and signed uploads)
 * without any network access, so the real app can be driven end to end.
 */
export async function mockSupabase(context: BrowserContext): Promise<void> {
  await context.route(`${SUPABASE_URL}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }

    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const { email } = request.postDataJSON() as { email: string };
      return route.fulfill({
        status: 200,
        headers: CORS,
        json: await sessionFor(email.toLowerCase()),
      });
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
