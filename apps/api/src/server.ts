import { createApp, type AppDeps } from "./app.js";
import { createSupabaseTokenVerifier } from "./auth/token-verifier.js";
import { createPrismaUserStore } from "./auth/user-store.js";
import { loadEnv } from "./config/env.js";
import { describeError } from "./http/log.js";
import { createPgRateLimitStore } from "./http/pg-rate-limit-store.js";
import { createWebhookReporter, reportError, setErrorReporter } from "./http/report.js";
import { failStaleJobs } from "./imports/service.js";
import { getPrisma } from "./lib/prisma.js";
import { createSupabaseMediaStorage } from "./storage/media-storage.js";

function readEnv() {
  try {
    return loadEnv();
  } catch (error) {
    // A configuration mistake is not a crash: say what to fix and stop.
    console.error(error instanceof Error ? error.message : "Invalid configuration");
    process.exit(1);
  }
}
const env = readEnv();

if (env.ERROR_WEBHOOK_URL) {
  setErrorReporter(createWebhookReporter(env.ERROR_WEBHOOK_URL));
} else if (env.NODE_ENV === "production") {
  console.warn("ERROR_WEBHOOK_URL is not set: unexpected errors will only appear in the logs");
}

const deps: AppDeps = {};
if (env.SUPABASE_URL && env.DATABASE_URL) {
  deps.auth = {
    verifyToken: createSupabaseTokenVerifier({
      supabaseUrl: env.SUPABASE_URL,
      jwtSecret: env.SUPABASE_JWT_SECRET,
    }),
    users: createPrismaUserStore(getPrisma(env.DATABASE_URL)),
    adminMfaRequired: env.ADMIN_MFA_REQUIRED,
  };
  deps.prisma = getPrisma(env.DATABASE_URL);
  if (env.RATE_LIMIT_STORE === "postgres") {
    const prisma = deps.prisma;
    deps.rateLimitStore = (prefix) => createPgRateLimitStore(prisma, prefix);
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const storage = createSupabaseMediaStorage({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_STORAGE_BUCKET,
      imageTransforms: env.SUPABASE_IMAGE_TRANSFORMS,
    });
    await storage.ensureBucket();
    deps.storage = storage;
  } else {
    console.warn("SUPABASE_SERVICE_ROLE_KEY not set — image uploads are disabled");
  }
  deps.webUrl = env.WEB_URL;
  deps.apiUrl = env.API_URL;
} else {
  console.warn("SUPABASE_URL or DATABASE_URL not set — authenticated routes are disabled");
}

const app = createApp(env, deps);
if (env.TRUST_PROXY === 0 && env.NODE_ENV === "production") {
  console.warn("TRUST_PROXY is 0 in production: rate limits will see the proxy's address");
}

// Imports that were running when the server last stopped can never finish; free their businesses.
if (deps.prisma) {
  const recovered = await failStaleJobs(deps.prisma, new Date(Date.now() + 15 * 60_000));
  if (recovered > 0) console.warn(`Marked ${recovered} interrupted import(s) as failed`);
}

const server = app.listen(env.PORT, () => {
  console.log(`KreateSpace API listening on port ${env.PORT}`);
});

// Stop taking new requests, let current ones finish, then close the database connection.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(() => {
    void (deps.prisma?.$disconnect() ?? Promise.resolve()).finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Never print the full error object: it can carry request or query data.
process.on("unhandledRejection", (reason) => {
  console.error(
    "Unhandled promise rejection",
    reason instanceof Error ? reason.name : typeof reason,
  );
  void reportError(reason, "unhandled promise rejection");
});

// The process cannot be trusted after this, so it stops (and the host restarts it), but only after
// the alert has had a moment to go out.
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", describeError(error));
  const stop = () => process.exit(1);
  void Promise.race([
    reportError(error, "uncaught exception"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]).finally(stop);
});
