import { createApp, type AppDeps } from "./app.js";
import { createSupabaseTokenVerifier } from "./auth/token-verifier.js";
import { createPrismaUserStore } from "./auth/user-store.js";
import { loadEnv } from "./config/env.js";
import { getPrisma } from "./lib/prisma.js";

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
  deps.webUrl = env.WEB_URL;
} else {
  console.warn("SUPABASE_URL or DATABASE_URL not set — authenticated routes are disabled");
}

const app = createApp(env, deps);

app.listen(env.PORT, () => {
  console.log(`KreateSpace API listening on port ${env.PORT}`);
});
