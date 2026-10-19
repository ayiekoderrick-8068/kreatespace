import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invitationTokenSchema } from "@kreatespace/shared";
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { AuthLayout, FormMessage, PrimaryButton } from "../components/forms";
import { ApiError, apiRequest } from "../lib/api";
import { forgetInvite, rememberInvite } from "../lib/pending-invite";
import { useApi, useCurrentUser } from "../lib/queries";

export function InvitePage() {
  const { token = "" } = useParams();
  const { session, user, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const api = useApi();
  const profile = useCurrentUser();
  const wellFormed = invitationTokenSchema.safeParse(token).success;

  useEffect(() => {
    if (wellFormed) rememberInvite(token);
  }, [token, wellFormed]);

  const lookup = useQuery({
    queryKey: ["invitation", token],
    queryFn: () =>
      apiRequest<{ valid: true; email: string } | { valid: false }>(
        `/api/invitations/lookup?token=${encodeURIComponent(token)}`,
      ),
    enabled: wellFormed,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.post<{ role: string }>("/api/invitations/accept", { token }),
    onSuccess: async () => {
      forgetInvite();
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate("/seller/register", { replace: true });
    },
  });

  if (!wellFormed || (lookup.data && !lookup.data.valid)) {
    return (
      <AuthLayout title="Invitation unavailable">
        <FormMessage kind="error">
          This invitation link is invalid, has expired, or has already been used. Please ask the
          KreateSpace team for a new one.
        </FormMessage>
        <Link to="/" className="mt-4 inline-block font-medium text-terracotta underline">
          Back to home
        </Link>
      </AuthLayout>
    );
  }

  if (lookup.isPending) {
    return (
      <AuthLayout title="Checking your invitation">
        <p role="status" className="text-ink-muted">
          Loading…
        </p>
      </AuthLayout>
    );
  }
  if (lookup.isError || !lookup.data?.valid) {
    return (
      <AuthLayout title="Something went wrong">
        <FormMessage kind="error">We couldn’t check this invitation. Please try again.</FormMessage>
      </AuthLayout>
    );
  }

  const invitedEmail = lookup.data.email;

  if (!session) {
    return (
      <AuthLayout
        title="You’re invited to sell on KreateSpace"
        subtitle={`This invitation is for ${invitedEmail}.`}
      >
        <p className="text-sm text-ink-muted">
          Create an account or log in with that email address to accept it.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Link
            to="/register"
            className="rounded-md bg-terracotta px-4 py-2.5 text-center font-medium text-white hover:bg-terracotta-dark"
          >
            Create an account
          </Link>
          <Link
            to="/login"
            state={{ from: `/invite/${token}` }}
            className="rounded-md border border-ink-muted/40 px-4 py-2.5 text-center font-medium hover:bg-cream"
          >
            I already have an account
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (user?.email?.toLowerCase() !== invitedEmail.toLowerCase()) {
    return (
      <AuthLayout title="Wrong account">
        <FormMessage kind="error">
          This invitation was sent to {invitedEmail}, but you’re signed in as {user?.email}. Log out
          and sign in with the invited email address.
        </FormMessage>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 font-medium text-terracotta underline"
        >
          Log out
        </button>
      </AuthLayout>
    );
  }

  if (profile.data && profile.data.role !== "CUSTOMER") {
    return (
      <AuthLayout title="You’re all set">
        <p className="text-sm text-ink-muted">Your account already has seller access.</p>
        <Link to="/seller" className="mt-4 inline-block font-medium text-terracotta underline">
          Go to your dashboard
        </Link>
      </AuthLayout>
    );
  }

  const error = accept.error instanceof ApiError ? accept.error.message : null;

  return (
    <AuthLayout
      title="You’re invited to sell on KreateSpace"
      subtitle="Accept your invitation to register your creative business."
    >
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <p className="mb-4 mt-2 text-sm text-ink-muted">
        After you accept, you’ll tell us about your business. Our team reviews every application
        before it appears publicly.
      </p>
      <PrimaryButton type="button" disabled={accept.isPending} onClick={() => accept.mutate()}>
        {accept.isPending ? "Accepting…" : "Accept invitation"}
      </PrimaryButton>
    </AuthLayout>
  );
}
