import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuth, type MfaEnrollment, type MfaStatus } from "../auth/AuthProvider";
import { useCurrentUser } from "../lib/queries";
import { FormMessage, PrimaryButton, SecondaryButton, TextField } from "./forms";

type Step =
  | { kind: "checking" }
  | { kind: "verify"; factorId: string }
  | { kind: "enroll"; enrollment: MfaEnrollment }
  | { kind: "failed"; message: string };

function CodeForm({
  factorId,
  submitLabel,
  onDone,
}: {
  factorId: string;
  submitLabel: string;
  onDone: () => void;
}) {
  const { mfa } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(clean)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await mfa.verify(factorId, clean);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      setCode("");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Verification code">
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <TextField
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoFocus
      />
      <PrimaryButton type="submit" disabled={busy} className="w-auto">
        {busy ? "Checking…" : submitLabel}
      </PrimaryButton>
    </form>
  );
}

/**
 * Administrators can change what the whole public sees, so a password alone is not enough: the
 * admin area opens only after a code from an authenticator app. This screen asks for the code, or
 * walks through setting the app up the first time. (The server enforces the same rule on every
 * admin request; this only explains it and lets the person complete it.)
 */
export function AdminMfaGate({ children }: { children: ReactNode }) {
  const profile = useCurrentUser();
  const { mfa, session, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: "checking" });

  const needed = profile.data?.mfa
    ? profile.data.mfa.required && !profile.data.mfa.satisfied
    : false;

  useEffect(() => {
    if (!needed) return;
    let active = true;
    void (async () => {
      const status: MfaStatus = await mfa.status();
      if (!active) return;
      if (status.error) return setStep({ kind: "failed", message: status.error });
      if (status.verifiedFactorId)
        return setStep({ kind: "verify", factorId: status.verifiedFactorId });
      const enrollment = await mfa.startEnrollment();
      if (!active) return;
      if ("error" in enrollment) return setStep({ kind: "failed", message: enrollment.error });
      setStep({ kind: "enroll", enrollment });
    })();
    return () => {
      active = false;
    };
  }, [needed, mfa]);

  // The server decides who counts as verified, from the session token. After a correct code the
  // browser receives a new, stronger token a moment later, so ask the server again only once it
  // has arrived. Asking sooner would just repeat the question with the old token.
  const token = session?.access_token;
  const previousToken = useRef(token);
  useEffect(() => {
    if (previousToken.current === token) return;
    previousToken.current = token;
    void queryClient.invalidateQueries();
  }, [token, queryClient]);

  if (profile.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        Loading…
      </p>
    );
  }
  if (!needed) return <>{children}</>;

  const done = () => setStep({ kind: "checking" });

  return (
    <section
      aria-labelledby="mfa-heading"
      className="mx-auto max-w-lg rounded-xl border border-sand bg-white p-6"
    >
      <h2 id="mfa-heading" className="text-xl font-semibold">
        Two-step verification
      </h2>

      {step.kind === "checking" ? (
        <p role="status" className="mt-3 text-ink-muted">
          Checking your sign-in…
        </p>
      ) : null}

      {step.kind === "failed" ? (
        <div className="mt-3 space-y-3">
          <FormMessage kind="error">{step.message}</FormMessage>
          <SecondaryButton type="button" onClick={() => window.location.reload()}>
            Try again
          </SecondaryButton>
        </div>
      ) : null}

      {step.kind === "verify" ? (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-ink-muted">
            Administrators confirm their sign-in with a code. Open your authenticator app and enter
            the current 6-digit code for KreateSpace.
          </p>
          <CodeForm factorId={step.factorId} submitLabel="Continue" onDone={done} />
          <p className="text-sm text-ink-muted">
            Lost your phone? Another way in is not available from this screen: ask the owner to
            reset your two-step verification.
          </p>
        </div>
      ) : null}

      {step.kind === "enroll" ? (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-ink-muted">
            Administrators must set up two-step verification before using the admin area.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Install an authenticator app on your phone (for example Google Authenticator).</li>
            <li>Scan this picture with the app, or type the key below into it by hand.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <img
            src={step.enrollment.qrCode}
            alt="QR code to add KreateSpace to your authenticator app"
            width={176}
            height={176}
            className="rounded-lg border border-sand bg-white p-2"
          />
          <p className="text-sm">
            Key for typing by hand:{" "}
            <code className="break-all rounded bg-cream px-1.5 py-0.5 font-mono text-xs">
              {step.enrollment.secret}
            </code>
          </p>
          <p className="text-xs text-ink-muted">
            Keep this key private. Anyone who has it can generate your codes.
          </p>
          <CodeForm factorId={step.enrollment.factorId} submitLabel="Finish set-up" onDone={done} />
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-6 text-sm font-medium text-terracotta underline"
      >
        Log out
      </button>
    </section>
  );
}
