import "dotenv/config";
import { loadEnv } from "../config/env.js";
import { failStaleJobs } from "../imports/service.js";
import { purgeOldInquiryEvents } from "../inquiries/service.js";
import { disconnectPrisma, getPrisma } from "../lib/prisma.js";
import { cleanupOrphanedUploads } from "../portfolio/images.js";
import { createSupabaseMediaStorage } from "../storage/media-storage.js";

// Usage (run daily, for example from a scheduled job):
//   pnpm --filter @kreatespace/api maintenance
// It is safe to run as often as you like and never touches live content:
//   - removes analytics events older than the retention period (13 months),
//   - deletes uploaded photos that never became part of a creation (older than a day),
//   - marks imports that were interrupted by a restart as failed.
async function main() {
  const env = loadEnv();
  const prisma = getPrisma();

  const purged = await purgeOldInquiryEvents(prisma);
  console.log(`Analytics events removed after the retention period: ${purged}`);

  const interrupted = await failStaleJobs(prisma);
  console.log(`Interrupted imports marked as failed: ${interrupted}`);

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const storage = createSupabaseMediaStorage({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_STORAGE_BUCKET,
    });
    const { removed } = await cleanupOrphanedUploads(prisma, storage);
    console.log(`Abandoned uploads deleted: ${removed}`);
  } else {
    console.log("Storage is not configured, so abandoned uploads were not checked.");
  }
}

main()
  .catch((error) => {
    console.error("Maintenance failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
