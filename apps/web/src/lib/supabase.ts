import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * Returns the browser Supabase client, or `null` when the project is not configured.
 * Only the public anon key is used here; the service-role key must never reach the frontend.
 *
 * Import this module with `import("./supabase")` rather than at the top of a file: it is a large
 * library that the home page can paint without.
 */
export function getSupabase(): SupabaseClient | null {
  if (client === undefined) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    client = url && anonKey ? createClient(url, anonKey) : null;
  }
  return client;
}
