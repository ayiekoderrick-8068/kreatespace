import { createClient } from "@supabase/supabase-js";

/** The one thing the server needs from the sign-in provider's admin side. */
export interface AuthAdmin {
  /** Removes the sign-in identity so the person can no longer log in. Already gone counts as done. */
  deleteUser(userId: string): Promise<void>;
}

/**
 * Supabase's admin client. It uses the server-side service-role key, so it must only ever run on the
 * server (the maintenance job), never in the website.
 */
export function createSupabaseAuthAdmin(config: {
  supabaseUrl: string;
  serviceRoleKey: string;
}): AuthAdmin {
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async deleteUser(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (!error) return;
      const gone = error.status === 404 || /not found/i.test(error.message);
      if (!gone) throw new Error(`Could not delete the sign-in identity: ${error.message}`);
    },
  };
}
