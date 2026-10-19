/** Shared settings for the end-to-end environment. */
export const API_PORT = 4100;
export const WEB_PORT = 5199;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const IMAGE_PORT = 4101;
export const IMAGE_URL = `http://127.0.0.1:${IMAGE_PORT}`;

/** The browser never reaches this host: Playwright answers its requests (see supabase-mock.ts). */
export const SUPABASE_URL = "http://supabase.e2e";
export const SUPABASE_ISSUER = `${SUPABASE_URL}/auth/v1`;
export const JWT_SECRET = "e2e-only-secret-that-is-at-least-32-characters-long";
export const STORAGE_BUCKET = "business-media";

export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/kreatespace_e2e";

export const ADMIN_EMAIL = "admin@kreatespace.test";
