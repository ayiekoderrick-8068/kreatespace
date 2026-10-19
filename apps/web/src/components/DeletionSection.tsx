import { RECENT_SIGN_IN_MINUTES } from "@kreatespace/shared";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  isOpenDeletion,
  useCancelDeletion,
  useDeletionState,
  useRequestDeletion,
  type DeletionRequestView,
  type DeletionState,
} from "../lib/account";
import { ApiError } from "../lib/api";
import { CheckboxField, FormMessage, PrimaryButton, SecondaryButton, TextField } from "./forms";

const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "long" });
const day = (iso: string) => dateFormat.format(new Date(iso));
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "REAUTHENTICATION_REQUIRED") {
      return `For your security, please confirm your password again. Your sign-in must be less than ${RECENT_SIGN_IN_MINUTES} minutes old.`;
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/** Waits briefly for a freshly signed-in session's token to reach the API helpers. */
async function waitForNewToken(read: () => string | undefined, previous: string | undefined) {
  for (let waited = 0; waited < 2000 && read() === previous; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function SavedAndAccount({ state }: { state: DeletionState }) {
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
      <li>Your KreateSpace account and your sign-in will be permanently deleted.</li>
      <li>
        {state.effects.savedCreations === 0
          ? "You have no saved creations."
          : `${plural(state.effects.savedCreations, "saved creation")} will be removed from your list.`}
      </li>
      <li>
        We keep only a record that a deletion happened. It holds counts, never your name, email or
        other personal details.
      </li>
    </ul>
  );
}

function RequestStatus({
  request,
  graceDays,
  onCancel,
  cancelling,
}: {
  request: DeletionRequestView;
  graceDays: number;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const waitingForReview = request.status === "REQUESTED" && request.needsReview;
  return (
    <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4" role="status">
      <p className="font-medium">
        {waitingForReview
          ? "Your request is waiting for an administrator’s review"
          : request.status === "APPROVED"
            ? "Your request was approved"
            : `Your account is scheduled for deletion`}
      </p>
      <p className="mt-1 text-sm">
        <strong>Nothing has been deleted yet.</strong>{" "}
        {waitingForReview ? (
          <>
            An administrator checks every request from a business owner, because the business
            disappears from KreateSpace. Once it is approved, your account is deleted on or after{" "}
            <time dateTime={request.scheduledFor}>{day(request.scheduledFor)}</time>.
          </>
        ) : (
          <>
            Your account will be deleted on or after{" "}
            <time dateTime={request.scheduledFor}>{day(request.scheduledFor)}</time> (we wait{" "}
            {plural(graceDays, "day")} so you can change your mind). Deletion happens during our
            daily clean-up, so it may take a little longer.
          </>
        )}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Asked on <time dateTime={request.requestedAt}>{day(request.requestedAt)}</time>. You can
        keep using KreateSpace until then.
      </p>
      <SecondaryButton type="button" className="mt-3" onClick={onCancel} disabled={cancelling}>
        {cancelling ? "Cancelling…" : "Keep my account (cancel the request)"}
      </SecondaryButton>
    </div>
  );
}

function RequestForm({ state, onDone }: { state: DeletionState; onDone: () => void }) {
  const { user, session, signIn } = useAuth();
  const request = useRequestDeletion();
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef(session?.access_token);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    token.current = session?.access_token;
  }, [session?.access_token]);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (password) {
        // Signing in again proves who is at the keyboard and refreshes the sign-in time.
        const before = token.current;
        const result = await signIn(user?.email ?? "", password);
        if (result.error) {
          setError(result.error);
          return;
        }
        await waitForNewToken(() => token.current, before);
        setPassword("");
      }
      await request.mutateAsync();
      onDone();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby="delete-heading"
      className="mt-4 space-y-4 rounded-xl border border-red-300 bg-white p-4"
    >
      <h3 id="delete-heading" ref={heading} tabIndex={-1} className="font-semibold outline-none">
        Delete your account
      </h3>
      <div>
        <p className="text-sm font-medium">If you go ahead:</p>
        <SavedAndAccount state={state} />
        {state.effects.business ? null : (
          <p className="mt-3 text-sm">
            Asking does not delete anything straight away. We wait {plural(state.graceDays, "day")}{" "}
            first, and you can cancel any time before then.
          </p>
        )}
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <TextField
        label="Your password"
        type="password"
        autoComplete="current-password"
        optional
        hint={`Confirms it’s you. Signed in with Google, or signed in within the last ${RECENT_SIGN_IN_MINUTES} minutes? You can leave this empty. If we ask again, log out, sign in and come straight back here.`}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <CheckboxField
        label="I understand that my account will be deleted and this can’t be undone once it happens."
        checked={understood}
        onChange={(event) => setUnderstood(event.target.checked)}
      />
      <PrimaryButton type="submit" disabled={!understood || busy} className="w-auto">
        {busy ? "Sending request…" : "Request account deletion"}
      </PrimaryButton>
    </form>
  );
}

/**
 * Account deletion, on the account page. Asking only starts a request; the screen says plainly what
 * has and has not happened, and what is still to come.
 */
export function DeletionSection() {
  const state = useDeletionState();
  const cancel = useCancelDeletion();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (state.isPending) {
    return (
      <p role="status" className="mt-10 text-sm text-ink-muted">
        Loading deletion options…
      </p>
    );
  }
  if (state.isError) {
    return (
      <section aria-labelledby="deletion-title" className="mt-10">
        <h2 id="deletion-title" className="text-xl font-semibold">
          Delete your account
        </h2>
        <div className="mt-3">
          <FormMessage kind="error">
            Couldn’t load your deletion options. Please refresh the page to try again.
          </FormMessage>
        </div>
      </section>
    );
  }

  const data = state.data;
  if (data.effects.role === "ADMIN") {
    return (
      <section aria-labelledby="deletion-title" className="mt-10">
        <h2 id="deletion-title" className="text-xl font-semibold">
          Delete your account
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Administrator accounts are removed by the owner of KreateSpace, not from here.
        </p>
      </section>
    );
  }
  const request = data.request;

  async function withdraw() {
    setCancelError(null);
    try {
      await cancel.mutateAsync();
      setNotice("Your request was cancelled. Your account stays as it is.");
    } catch (failure) {
      setCancelError(errorText(failure));
    }
  }

  return (
    <section aria-labelledby="deletion-title" className="mt-10 border-t border-sand pt-8">
      <h2 id="deletion-title" className="text-xl font-semibold">
        Delete your account
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        You can ask us to permanently delete your account and the personal details we hold.
      </p>

      {notice ? (
        <div className="mt-4">
          <FormMessage kind="success">{notice}</FormMessage>
        </div>
      ) : null}
      {cancelError ? (
        <div className="mt-4">
          <FormMessage kind="error">{cancelError}</FormMessage>
        </div>
      ) : null}

      {isOpenDeletion(request) ? (
        <RequestStatus
          request={request!}
          graceDays={data.graceDays}
          onCancel={() => void withdraw()}
          cancelling={cancel.isPending}
        />
      ) : (
        <>
          {request?.status === "REJECTED" ? (
            <div className="mt-4">
              <FormMessage kind="info">
                Your last request wasn’t approved
                {request.reviewNote ? `: ${request.reviewNote}` : "."} You can ask again once that
                is sorted out.
              </FormMessage>
            </div>
          ) : null}
          {open ? (
            <RequestForm
              state={data}
              onDone={() => {
                setOpen(false);
                setNotice(null);
              }}
            />
          ) : (
            <SecondaryButton
              type="button"
              className="mt-4 border-red-300 text-red-800"
              onClick={() => {
                setNotice(null);
                setOpen(true);
              }}
            >
              Delete my account…
            </SecondaryButton>
          )}
        </>
      )}
    </section>
  );
}
