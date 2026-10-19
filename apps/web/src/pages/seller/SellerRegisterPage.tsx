import { useState } from "react";
import { Link } from "react-router";
import { BusinessWizard } from "../../components/BusinessWizard";
import { FormMessage } from "../../components/forms";
import { StatusBadge } from "../../components/StatusBadge";
import { useOwnBusiness } from "../../lib/queries";

export function SellerRegisterPage() {
  const own = useOwnBusiness();
  const [submitted, setSubmitted] = useState(false);

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
        <FormMessage kind="error">We couldn’t load your application. Please try again.</FormMessage>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Application submitted</h1>
        <div className="mt-4">
          <FormMessage kind="success">
            Thank you! Our team will review your business before it appears on KreateSpace. You can
            check the status at any time.
          </FormMessage>
        </div>
        <Link to="/" className="mt-6 inline-block font-medium text-terracotta underline">
          Back to home
        </Link>
      </main>
    );
  }

  const business = own.data;
  if (business && !["DRAFT", "CHANGES_REQUESTED"].includes(business.business.status)) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Your application</h1>
        <p className="mt-3 flex items-center gap-2">
          Status: <StatusBadge status={business.business.status} />
        </p>
        <Link to="/" className="mt-6 inline-block font-medium text-terracotta underline">
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Register your business</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Tell us about your creative business. Your information is saved as you go, and nothing is
        public until our team approves it.
      </p>
      <div className="mt-6">
        <BusinessWizard
          mode="register"
          business={business ?? null}
          onSubmitted={() => setSubmitted(true)}
        />
      </div>
    </main>
  );
}
