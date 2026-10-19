import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabase } from "../lib/supabase";
import { authErrorMessage, isAlreadyRegistered } from "./errors";

/** The subset of the Supabase auth client the app relies on (easy to fake in tests). */
export type AuthClient = Pick<
  SupabaseClient["auth"],
  | "getSession"
  | "onAuthStateChange"
  | "signInWithPassword"
  | "signUp"
  | "signOut"
  | "resetPasswordForEmail"
  | "updateUser"
  | "signInWithOAuth"
>;

export interface AuthResult {
  error: string | null;
}

export interface SignUpResult extends AuthResult {
  /** True when the account was created but the email address still needs to be verified. */
  needsEmailVerification: boolean;
}

export interface AuthContextValue {
  /** False when Supabase environment variables are missing. */
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  /** True after following a password-recovery email link. */
  recovering: boolean;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(input: { email: string; password: string; fullName: string }): Promise<SignUpResult>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<AuthResult>;
  updatePassword(password: string): Promise<AuthResult>;
  signInWithGoogle(): Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_CONFIGURED = "Authentication is not configured for this environment.";

export function AuthProvider({
  children,
  client,
}: {
  children: ReactNode;
  /** Override for tests; defaults to the app's Supabase client. */
  client?: AuthClient | null;
}) {
  const auth: AuthClient | null = useMemo(
    () => (client !== undefined ? client : (getSupabase()?.auth ?? null)),
    [client],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(auth));
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!auth) return;
    let active = true;

    const { data } = auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (event === "SIGNED_OUT") setRecovering(false);
    });

    void auth.getSession().then(({ data: current }) => {
      if (!active) return;
      setSession((existing) => existing ?? current.session);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [auth]);

  const value = useMemo<AuthContextValue>(() => {
    const origin = window.location.origin;
    return {
      configured: auth !== null,
      loading,
      session,
      user: session?.user ?? null,
      recovering,
      async signIn(email, password) {
        if (!auth) return { error: NOT_CONFIGURED };
        const { error } = await auth.signInWithPassword({ email, password });
        return { error: authErrorMessage(error) };
      },
      async signUp({ email, password, fullName }) {
        if (!auth) return { error: NOT_CONFIGURED, needsEmailVerification: false };
        const { data, error } = await auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: `${origin}/login` },
        });
        // An address that already has an account looks exactly like a new sign-up, so the form
        // can't be used to discover who is registered.
        if (isAlreadyRegistered(error)) return { error: null, needsEmailVerification: true };
        return {
          error: authErrorMessage(error),
          needsEmailVerification: !error && !data.session,
        };
      },
      async signOut() {
        await auth?.signOut();
      },
      async requestPasswordReset(email) {
        if (!auth) return { error: NOT_CONFIGURED };
        const { error } = await auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/reset-password`,
        });
        return { error: authErrorMessage(error) };
      },
      async updatePassword(password) {
        if (!auth) return { error: NOT_CONFIGURED };
        const { error } = await auth.updateUser({ password });
        if (!error) setRecovering(false);
        return { error: authErrorMessage(error) };
      },
      async signInWithGoogle() {
        if (!auth) return { error: NOT_CONFIGURED };
        const { error } = await auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: origin },
        });
        return { error: authErrorMessage(error) };
      },
    };
  }, [auth, loading, session, recovering]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
