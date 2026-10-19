import pg from "pg";
import { ADMIN_EMAIL, DATABASE_URL } from "./env.ts";
import { userIdFor } from "./supabase-mock.ts";

/** Starts every run from an empty database that contains only the administrator. */
export default async function globalSetup() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('TRUNCATE TABLE "users" CASCADE');
    await client.query(
      `INSERT INTO "users" ("id", "email", "fullName", "role", "updatedAt")
       VALUES ($1, $2, 'KreateSpace Admin', 'ADMIN', now())`,
      [userIdFor(ADMIN_EMAIL), ADMIN_EMAIL],
    );
  } finally {
    await client.end();
  }
}
