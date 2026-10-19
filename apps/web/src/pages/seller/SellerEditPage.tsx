import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { BusinessWizard } from "../../components/BusinessWizard";
import { FormMessage, PrimaryButton } from "../../components/forms";
import { ApiError } from "../../lib/api";
import { queryKeys, useApi, useOwnBusiness } from "../../lib/queries";

/** Lets an approved seller edit their profile. Changes go to review before they replace the live version. */
export function SellerEditPage() {
  const own = useOwnBusiness();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);

  const start = useMutation({
    mutationFn: () => api.post("/api/businesses/me/revisions"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.ownBusiness }),
  });

  if (own.isPending) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10" role="status">
        Loading…
      </main>
    );
  }
  if (own.isError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <FormMessage kind="error">We couldn’t load your profile. Please try again.</FormMessage>
      </main>
    );
  }

  const data = own.data;
  if (!data || data.business.status !== "APPROVED") {
    return <Navigate to="/seller" replace />;
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Update submitted</h1>
        <div className="mt-4">
          <FormMessage kind="success">
            Thanks! Our team will review your changes. Your current profile stays live until they’re
            approved.
          </FormMessage>
        </div>
        <Link to="/seller" className="mt-6 inline-block font-medium text-terracotta underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const isOpenUpdate =
    data.publishedRevision !== null &&
    ["DRAFT", "CHANGES_REQUESTED"].includes(data.revision.status);

  if (data.revision.status === "PENDING" && data.publishedRevision) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Update in review</h1>
        <div className="mt-4">
          <FormMessage kind="info">
            Your latest changes are waiting for review, so they can’t be edited right now.
          </FormMessage>
        </div>
        <button
          type="button"
          onClick={() => navigate("/seller")}
          className="mt-6 font-medium text-terracotta underline"
        >
          Back to dashboard
        </button>
      </main>
    );
  }

  if (!isOpenUpdate) {
    const error = start.error instanceof ApiError ? start.error.message : null;
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Edit your profile</h1>
        <p className="mt-3 text-sm text-ink-muted">
          You can change any detail or photo. Your edits are saved as a draft and sent to our team
          for review — your live profile doesn’t change until they approve.
        </p>
        {error ? (
          <div className="mt-4">
            <FormMessage kind="error">{error}</FormMessage>
          </div>
        ) : null}
        <div className="mt-5 max-w-xs">
          <PrimaryButton type="button" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? "Preparing…" : "Start editing"}
          </PrimaryButton>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Update your profile</h1>
      <div className="mt-2">
        <FormMessage kind="info">
          Your current profile stays live. Changes appear only after our team approves them.
        </FormMessage>
      </div>
      <div className="mt-6">
        <BusinessWizard
          key={data.revision.id}
          mode="update"
          business={data}
          onSubmitted={() => setSubmitted(true)}
        />
      </div>
    </main>
  );
}
