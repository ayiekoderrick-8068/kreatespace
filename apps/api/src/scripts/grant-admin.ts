import "dotenv/config";
import { recordAudit } from "../audit.js";
import { disconnectPrisma, getPrisma } from "../lib/prisma.js";

// Usage: pnpm --filter @kreatespace/api admin:grant <email>
// The person must have signed up (and signed in once) so their profile row exists.
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: admin:grant <email>");
    process.exitCode = 1;
    return;
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found for ${email}. Ask them to sign up and log in first.`);
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    await recordAudit(tx, {
      actorId: null,
      action: "user.admin_granted",
      entityType: "User",
      entityId: user.id,
      metadata: { email, via: "cli" },
    });
  });
  console.log(`${email} is now an administrator.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
