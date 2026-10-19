import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { resetAdministratorMfa } from "../auth/mfa-admin.js";
import { disconnectPrisma, getPrisma } from "../lib/prisma.js";

// Usage:  pnpm --filter @kreatespace/api admin:reset-mfa admin@example.com
// For an administrator who has lost their authenticator app. Needs SUPABASE_URL and the
// server-side SUPABASE_SERVICE_ROLE_KEY in the environment. Run it yourself, on a machine you
// trust; confirm the person's identity first (for example by phone), because afterwards they only
// need their password to enroll a new authenticator.
async function main() {
  const email = process.argv[2];
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!email || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "Usage: admin:reset-mfa <email>   (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)",
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const outcome = await resetAdministratorMfa(
    getPrisma(),
    {
      async listFactors(userId) {
        const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId });
        if (error) throw new Error(`Could not list factors: ${error.message}`);
        return data.factors;
      },
      async deleteFactor(userId, id) {
        const { error } = await supabase.auth.admin.mfa.deleteFactor({ userId, id });
        if (error) throw new Error(`Could not remove a factor: ${error.message}`);
      },
    },
    email,
  );

  const messages = {
    reset: `Removed ${"removed" in outcome ? outcome.removed : 0} factor(s) for ${email}. They can now sign in and enroll a new authenticator.`,
    "no-such-user": `No account found for ${email}. They need to sign in once first.`,
    "not-an-administrator": `${email} is not an administrator, so nothing was changed.`,
    "nothing-to-reset": `${email} has no second-step factor enrolled, so nothing was changed.`,
  } as const;
  console.log(messages[outcome.status]);
  if (outcome.status !== "reset") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Reset failed");
    process.exitCode = 1;
  })
  .finally(disconnectPrisma);
