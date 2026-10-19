// Stops a production deployment that still has the placeholder API address in vercel.json, which
// would break every API call (the security policy would block them) and the search engine pages.
// Replace __API_ORIGIN__ with the API's host name, for example api.example.com (no https://).
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
const isProduction = process.env.VERCEL_ENV === "production";

if (config.includes("__API_ORIGIN__")) {
  const message =
    "vercel.json still contains __API_ORIGIN__. Replace it with your API's host name " +
    "(for example api.example.com) before deploying. See docs/DEPLOYMENT.md.";
  if (isProduction) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
  }
  console.warn(`WARNING: ${message}`);
}

if (isProduction) {
  for (const name of ["VITE_API_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
    if (!process.env[name]) {
      console.error(`ERROR: ${name} is not set for the production build.`);
      process.exit(1);
    }
  }
  if (!process.env.VITE_API_URL.startsWith("https://")) {
    console.error("ERROR: VITE_API_URL must be an https address.");
    process.exit(1);
  }
}
