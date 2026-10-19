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
  | "mfa"
>;

/** Where a person stands with two-step verification. */
export interface MfaStatus {
  /** "aal2" once a code from the authenticator app has been verified in this session. */
  level: "aal1" | "aal2";
  /** The authenticator they have already set up, if any. */
  verifiedFactorId: string | null;
  error?: string;
}

export interface MfaEnrollment {
  factorId: string;
  /** A picture of the QR code, as an image address. */
  qrCode: string;
  /** The same key as text, for typing into an app by hand. */
  secret: string;
}

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
  signUp(input: {
    email: string;
    password: string;
    fullName: string;
    /** The version of the Terms and Privacy Policy the person agreed to, recorded with the account. */
    termsVersion?: string;
  }): Promise<SignUpResult>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<AuthResult>;
  updatePassword(password: string): Promise<AuthResult>;
  signInWithGoogle(): Promise<AuthResult>;
  mfa: {
    status(): Promise<MfaStatus>;
    /** Begins setting up an authenticator app; any abandoned earlier attempt is discarded. */
    startEnrollment(): Promise<MfaEnrollment | { error: string }>;
    /** Checks a 6-digit code, either to finish setup or to complete a sign-in. */
    verify(factorId: string, code: string): Promise<AuthResult>;
    discardEnrollment(factorId: string): Promise<void>;
  };
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_CONFIGURED = "Authentication is not configured for this environment.";
const GENERIC_MFA_ERROR = "Two-step verification isn’t available right now. Please try again.";

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
      async signUp({ email, password, fullName, termsVersion }) {
        const current = await ready();
        if (!current) return { error: NOT_CONFIGURED, needsEmailVerification: false };
        const { data, error } = await current.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              ...(termsVersion
                ? { terms_version: termsVersion, terms_accepted_at: new Date().toISOString() }
                : {}),
            },
            emailRedirectTo: `${origin}/login`,
          },
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
      mfa: {
        async status() {
          const current = await ready();
          if (!current) return { level: "aal1", verifiedFactorId: null, error: NOT_CONFIGURED };
          const [level, factors] = await Promise.all([
            current.mfa.getAuthenticatorAssuranceLevel(),
            current.mfa.listFactors(),
          ]);
          if (level.error || factors.error) {
            return { level: "aal1", verifiedFactorId: null, error: GENERIC_MFA_ERROR };
          }
          return {
            level: level.data.currentLevel === "aal2" ? "aal2" : "aal1",
            verifiedFactorId: factors.data.totp[0]?.id ?? null,
          };
        },
        async startEnrollment() {
          const current = await ready();
          if (!current) return { error: NOT_CONFIGURED };
          // An earlier attempt that was never finished would otherwise block a new one.
          const existing = await current.mfa.listFactors();
          for (const factor of existing.data?.all ?? []) {
            if (factor.factor_type === "totp" && factor.status === "unverified") {
              await current.mfa.unenroll({ factorId: factor.id });
            }
          }
          const { data, error } = await current.mfa.enroll({
            factorType: "totp",
            friendlyName: "Authenticator app",
          });
          if (error || !data) return { error: GENERIC_MFA_ERROR };
          return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
        },
        async verify(factorId, code) {
          const current = await ready();
          if (!current) return { error: NOT_CONFIGURED };
          const { error } = await current.mfa.challengeAndVerify({ factorId, code });
          return {
            error: error
              ? "That code didn’t work. Check the 6-digit code in your authenticator app and try again."
              : null,
          };
        },
        async discardEnrollment(factorId) {
          await (await ready())?.mfa.unenroll({ factorId });
        },
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
