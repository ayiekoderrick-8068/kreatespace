/**
 * What the build knows about Supabase, without loading the library. Kept apart from `supabase.ts`
 * so that pages which only need to know whether sign-in exists do not pay for the whole client.
 */
export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export const isGoogleAuthEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";
