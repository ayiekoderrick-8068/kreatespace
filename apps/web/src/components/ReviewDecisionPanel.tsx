import { REASON_MIN_LENGTH, reviewDecisionSchema, type ReviewCommand } from "@kreatespace/shared";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { FormMessage, PrimaryButton, SecondaryButton, TextAreaField } from "./forms";

interface Props {
  /** A submission is waiting: approve, request changes and reject are offered. */
  awaitingReview: boolean;
  canSuspend: boolean;
  canReinstate: boolean;
  /** Explains what approval will do. */
  approveHint?: string;
  /** Sends the decision. Throw (ideally an ApiError) to show a message. */
  onDecide: (decision: { action: ReviewCommand; reason?: string }) => Promise<void>;
  suspendLabel?: string;
  reinstateLabel?: string;
}

/** The admin decision controls shared by the creation and package review pages. */
export function ReviewDecisionPanel({
  awaitingReview,
  canSuspend,
  canReinstate,
  approveHint,
  onDecide,
  suspendLabel = "Suspend",
  reinstateLabel = "Reinstate",
}: Props) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReviewCommand | null>(null);

  if (!awaitingReview && !canSuspend && !canReinstate) {
    return (
      <section className="rounded-xl border border-cream-dark bg-white p-5">
        <h2 className="text-lg font-semibold">Decision</h2>
        <p className="mt-2 text-sm text-ink-muted">
          There’s nothing to review right now. Nothing is awaiting a decision.
        </p>
      </section>
    );
  }

  async function run(action: ReviewCommand) {
    const parsed = reviewDecisionSchema.safeParse({ action, reason: reason.trim() || undefined });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Check your decision");
      return;
    }
    setFieldError(null);
    setError(null);
    setPending(action);
    try {
      await onDecide({ action, reason: reason.trim() || undefined });
      setReason("");
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : "Something went wrong. Please try again.",
      );
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;
  return (
    <section aria-label="Decision" className="rounded-xl border border-cream-dark bg-white p-5">
      <h2 className="text-lg font-semibold">Decision</h2>
      {approveHint && awaitingReview ? (
        <p className="mt-1 text-sm text-ink-muted">{approveHint}</p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : null}
      <div className="mt-4">
        <TextAreaField
          label="Reason or feedback"
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint={`Required (at least ${REASON_MIN_LENGTH} characters) to request changes, reject or suspend. Sellers can see this message.`}
          error={fieldError ?? undefined}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {awaitingReview ? (
          <>
            <PrimaryButton
              type="button"
              className="w-auto"
              disabled={busy}
              onClick={() => void run("APPROVE")}
            >
              {pending === "APPROVE" ? "Approving…" : "Approve"}
            </PrimaryButton>
            <SecondaryButton
              type="button"
              disabled={busy}
              onClick={() => void run("REQUEST_CHANGES")}
            >
              Request changes
            </SecondaryButton>
            <SecondaryButton
              type="button"
              disabled={busy}
              className="text-red-800"
              onClick={() => void run("REJECT")}
            >
              Reject
            </SecondaryButton>
          </>
        ) : null}
        {canSuspend ? (
          <SecondaryButton
            type="button"
            disabled={busy}
            className="text-red-800"
            onClick={() => void run("SUSPEND")}
          >
            {suspendLabel}
          </SecondaryButton>
        ) : null}
        {canReinstate ? (
          <PrimaryButton
            type="button"
            className="w-auto"
            disabled={busy}
            onClick={() => void run("REINSTATE")}
          >
            {reinstateLabel}
          </PrimaryButton>
        ) : null}
      </div>
    </section>
  );
}
