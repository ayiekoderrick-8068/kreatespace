import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { rememberPendingSave } from "../lib/pending-save";
import { useSavedIds, useToggleSave } from "../lib/queries";
import { HeartIcon } from "./icons";

/** A friendly invitation to log in; the creation is remembered so saving can finish afterwards. */
function LoginInvitation({
  title,
  returnTo,
  onClose,
}: {
  title: string;
  returnTo: string;
  onClose: () => void;
}) {
  const firstAction = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    firstAction.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-invite-title"
        className="w-full max-w-sm rounded-2xl bg-cream p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="save-invite-title" className="text-xl font-semibold">
          Save it for later
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Log in or create a free account to save “{title}”. We’ll save it as soon as you’re in.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Link
            ref={firstAction}
            to="/login"
            state={{ from: returnTo }}
            className="rounded-full bg-terracotta px-5 py-2.5 text-center font-medium text-white hover:bg-terracotta-dark"
          >
            Log in
          </Link>
          <Link
            to="/register"
            state={{ from: returnTo }}
            className="rounded-full border border-ink-muted/40 bg-white px-5 py-2.5 text-center font-medium hover:bg-cream-dark"
          >
            Create an account
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-ink-muted underline"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

export function SaveButton({
  creationId,
  title,
  variant = "icon",
}: {
  creationId: string;
  title: string;
  variant?: "icon" | "button";
}) {
  const { session } = useAuth();
  const location = useLocation();
  const savedIds = useSavedIds();
  const toggle = useToggleSave();
  const [inviting, setInviting] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const saved = Boolean(session) && (savedIds.data?.includes(creationId) ?? false);

  function onClick() {
    if (!session) {
      rememberPendingSave({ creationId, title });
      setInviting(true);
      return;
    }
    const save = !saved;
    toggle.mutate(
      { creationId, save },
      {
        onSuccess: () => setAnnouncement(save ? `Saved ${title}` : `Removed ${title} from saved`),
        onError: () =>
          setAnnouncement(`Couldn’t update saved list for ${title}. Please try again.`),
      },
    );
  }

  const label = saved ? `Remove “${title}” from saved` : `Save “${title}”`;

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          aria-pressed={saved}
          aria-label={label}
          onClick={onClick}
          className={`flex h-10 w-10 items-center justify-center rounded-full shadow-sm backdrop-blur transition-colors ${
            saved
              ? "bg-terracotta text-white"
              : "bg-white/90 text-ink opacity-100 hover:bg-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          }`}
        >
          <HeartIcon filled={saved} className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          aria-pressed={saved}
          onClick={onClick}
          className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 font-medium ${
            saved
              ? "border-terracotta bg-terracotta text-white"
              : "border-ink-muted/40 bg-white hover:bg-cream-dark"
          }`}
        >
          <HeartIcon filled={saved} className="h-5 w-5" />
          {saved ? "Saved" : "Save"}
        </button>
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {inviting ? (
        <LoginInvitation
          title={title}
          returnTo={`${location.pathname}${location.search}`}
          onClose={() => setInviting(false)}
        />
      ) : null}
    </>
  );
}
