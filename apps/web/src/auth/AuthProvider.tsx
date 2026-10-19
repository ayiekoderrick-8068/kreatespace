import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isSupabaseConfigured } from "../lib/supabase-config";
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

/**
 * Whether the browser could be signed in already: a stored Supabase session, or the address of a
 * sign-in redirect (Google, password recovery, email links). Visitors without either never need the
 * sign-in library just to browse, so it is only fetched when they actually sign in. If the browser
 * will not say (storage blocked), assume yes.
 */
function mightHaveSession(): boolean {
  try {
    const { hash, search } = window.location;
    if (
      /[#?&](access_token|refresh_token|code|error_description|type)=/.test(`${hash}&${search}`)
    ) {
      return true;
    }
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token")) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function AuthProvider({
  children,
  client,
}: {
  children: ReactNode;
  /** Override for tests; defaults to the app's Supabase client. */
  client?: AuthClient | null;
}) {
  const injected = client !== undefined;
  const configured = injected ? client !== null : isSupabaseConfigured;

  // The real client is a large library, so it is fetched after the first paint rather than before
  // it: visitors can browse straight away and sign-in becomes available a moment later.
  const loader = useRef<Promise<AuthClient | null> | null>(null);
  const loadAuth = useCallback((): Promise<AuthClient | null> => {
    loader.current ??= import("../lib/supabase").then(
      (module) => module.getSupabase()?.auth ?? null,
    );
    return loader.current;
  }, []);
  const [loadedAuth, setLoadedAuth] = useState<AuthClient | null>(null);
  const auth: AuthClient | null = injected ? client : loadedAuth;

  const [session, setSession] = useState<Session | null>(null);
  // Decided once, up front: whether there may be a session to restore (see mightHaveSession).
  const [mayHaveSession] = useState(() =>
    injected ? configured : configured && mightHaveSession(),
  );
  const [loading, setLoading] = useState(mayHaveSession);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (injected || !mayHaveSession) return;
    let active = true;
    void loadAuth().then((loaded) => {
      if (!active) return;
      setLoadedAuth(loaded);
      if (!loaded) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [injected, mayHaveSession, loadAuth]);

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
    /** The client, waiting for it to arrive if someone acts before it has loaded. */
    const ready = async (): Promise<AuthClient | null> => {
      if (auth) return auth;
      if (injected || !configured) return null;
      const loaded = await loadAuth();
      setLoadedAuth(loaded);
      return loaded;
    };
    return {
      configured,
      loading,
      session,
      user: session?.user ?? null,
      recovering,
      async signIn(email, password) {
        const current = await ready();
        if (!current) return { error: NOT_CONFIGURED };
        const { error } = await current.signInWithPassword({ email, password });
        return { error: authErrorMessage(error) };
      },
      async signUp({ email, password, fullName }) {
        const current = await ready();
        if (!current) return { error: NOT_CONFIGURED, needsEmailVerification: false };
        const { data, error } = await current.signUp({
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
        await (await ready())?.signOut();
      },
      async requestPasswordReset(email) {
        const current = await ready();
        if (!current) return { error: NOT_CONFIGURED };
        const { error } = await current.resetPasswordForEmail(email, {
          redirectTo: `${origin}/reset-password`,
        });
        return { error: authErrorMessage(error) };
      },
      async updatePassword(password) {
        const current = await ready();
        if (!current) return { error: NOT_CONFIGURED };
        const { error } = await current.updateUser({ password });
        if (!error) setRecovering(false);
        return { error: authErrorMessage(error) };
      },
      async signInWithGoogle() {
        const current = await ready();
        if (!current) return { error: NOT_CONFIGURED };
        const { error } = await current.signInWithOAuth({
          provider: "google",
          options: { redirectTo: origin },
        });
        return { error: authErrorMessage(error) };
      },
    };
  }, [auth, injected, configured, loadAuth, loading, session, recovering]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
