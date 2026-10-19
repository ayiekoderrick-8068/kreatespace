import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` loads this file but never connects, so a placeholder keeps installs and CI
// working without a database. Commands that connect (migrate, studio) need a real DATABASE_URL.
const PLACEHOLDER_URL = "postgresql://unset:unset@localhost:5432/unset";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? PLACEHOLDER_URL,
  },
});
