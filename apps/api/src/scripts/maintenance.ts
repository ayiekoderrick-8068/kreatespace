import "dotenv/config";
import { processAccountDeletions, purgeDeletionTombstones } from "../accounts/deletion.js";
import { createSupabaseAuthAdmin } from "../auth/supabase-admin.js";
import { loadEnv } from "../config/env.js";
import { purgeExpiredRateLimits } from "../http/pg-rate-limit-store.js";
import { createWebhookReporter, reportError, setErrorReporter } from "../http/report.js";
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
//   - marks imports that were interrupted by a restart as failed,
//   - carries out account deletions whose waiting period (and, for businesses, review) is over.
async function main() {
  const env = loadEnv();
  if (env.ERROR_WEBHOOK_URL) setErrorReporter(createWebhookReporter(env.ERROR_WEBHOOK_URL));
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

    const deletions = await processAccountDeletions(prisma, {
      storage,
      authAdmin: createSupabaseAuthAdmin({
        supabaseUrl: env.SUPABASE_URL,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      }),
    });
    console.log(
      `Account deletions: ${deletions.completed} completed, ${deletions.waiting} waiting, ${deletions.failed} failed`,
    );
    if (deletions.failed > 0) {
      process.exitCode = 1; // so the scheduler shows the run as failed
      await reportError(
        new Error(`${deletions.failed} account deletion(s) failed and will be retried`),
        "account deletions",
        "maintenance",
      );
    }
  } else {
    console.log(
      "Storage and sign-in admin are not configured, so abandoned uploads and account deletions were not processed.",
    );
  }

  const counters = await purgeExpiredRateLimits(prisma);
  console.log(`Expired rate-limit counters removed: ${counters}`);

  const forgotten = await purgeDeletionTombstones(prisma);
  console.log(`Deleted-account markers forgotten after their short window: ${forgotten}`);
}

main()
  .catch(async (error) => {
    console.error("Maintenance failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
    await reportError(error, "maintenance", "maintenance");
  })
  .finally(disconnectPrisma);
