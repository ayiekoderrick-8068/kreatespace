import { createApp, type AppDeps } from "./app.js";
import { createSupabaseTokenVerifier } from "./auth/token-verifier.js";
import { createPrismaUserStore } from "./auth/user-store.js";
import { loadEnv } from "./config/env.js";
import { getPrisma } from "./lib/prisma.js";
import { createSupabaseMediaStorage } from "./storage/media-storage.js";

const env = loadEnv();

const deps: AppDeps = {};
if (env.SUPABASE_URL && env.DATABASE_URL) {
  deps.auth = {
    verifyToken: createSupabaseTokenVerifier({
      supabaseUrl: env.SUPABASE_URL,
      jwtSecret: env.SUPABASE_JWT_SECRET,
    }),
    users: createPrismaUserStore(getPrisma(env.DATABASE_URL)),
  };
  deps.prisma = getPrisma(env.DATABASE_URL);
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const storage = createSupabaseMediaStorage({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_STORAGE_BUCKET,
    });
    await storage.ensureBucket();
    deps.storage = storage;
  } else {
    console.warn("SUPABASE_SERVICE_ROLE_KEY not set — image uploads are disabled");
  }
  deps.webUrl = env.WEB_URL;
} else {
  console.warn("SUPABASE_URL or DATABASE_URL not set — authenticated routes are disabled");
}

const app = createApp(env, deps);

app.listen(env.PORT, () => {
  console.log(`KreateSpace API listening on port ${env.PORT}`);
});
