import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { useCurrentUser } from "../lib/queries";

const STEPS = [
  {
    title: "Get invited",
    body: "We’re onboarding creative businesses by invitation while we grow. Your invitation link is sent to the email address you give us.",
  },
  {
    title: "Tell us about your business",
    body: "Share your story, location, WhatsApp number and photos of your best work. A website is optional.",
  },
  {
    title: "We review it",
    body: "Our team checks every application before it goes live, and you’ll see the decision (and any feedback) in your dashboard.",
  },
  {
    title: "Get discovered",
    body: "Customers find your work, open your profile and contact you directly on WhatsApp or your website.",
  },
];

export function ForBusinessesPage() {
  const { user } = useAuth();
  const { data: profile } = useCurrentUser();

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-4xl font-semibold tracking-tight">
        Show your work to the people looking for it
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-ink-muted">
        KreateSpace gives every approved business a free public profile and a place in our discovery
        feed. Customers contact <em>you</em> — not us.
      </p>

      <ol className="mt-10 grid gap-5 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-2xl border border-sand bg-white p-6">
            <span className="text-sm font-medium text-terracotta">Step {index + 1}</span>
            <h2 className="mt-1 text-xl font-semibold">{step.title}</h2>
            <p className="mt-2 text-sm text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>

      <section className="mt-10 rounded-2xl bg-cream-dark p-6">
        <h2 className="text-xl font-semibold">Ready to join?</h2>
        {profile?.role === "SELLER" ? (
          <>
            <p className="mt-2 text-sm text-ink-muted">You already have seller access.</p>
            <Link
              to="/seller"
              className="mt-4 inline-block rounded-full bg-terracotta px-5 py-2.5 font-medium text-white hover:bg-terracotta-dark"
            >
              Go to your dashboard
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              If you’ve received an invitation link, open it to get started. If you’d like to be
              invited, get in touch with the KreateSpace team.
            </p>
            {user ? null : (
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  to="/register"
                  className="rounded-full bg-terracotta px-5 py-2.5 font-medium text-white hover:bg-terracotta-dark"
                >
                  Create an account
                </Link>
                <Link
                  to="/login"
                  className="rounded-full border border-ink-muted/40 bg-white px-5 py-2.5 font-medium hover:bg-cream"
                >
                  Log in
                </Link>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
