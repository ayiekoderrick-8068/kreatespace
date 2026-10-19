import "dotenv/config";
import { removeDevFixtures, seedDevFixtures } from "../dev/fixtures.js";
import { disconnectPrisma, getPrisma } from "../lib/prisma.js";

// Usage:
//   pnpm --filter @kreatespace/api seed:dev            add development fixtures
//   pnpm --filter @kreatespace/api seed:dev --remove   delete them again
// The fixtures are placeholders, not real businesses, so this refuses to run in production.
async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run: development fixtures must never be added in production.");
    process.exitCode = 1;
    return;
  }

  const prisma = getPrisma();
  if (process.argv.includes("--remove")) {
    console.log(`Removed ${await removeDevFixtures(prisma)} development fixture business(es).`);
    return;
  }
  const result = await seedDevFixtures(prisma);
  console.log(
    `Development fixtures: ${result.businesses} businesses and ${result.creations} creations added` +
      (result.skipped ? ` (${result.skipped} already present)` : "") +
      ".",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
