import { Link } from "react-router";

export function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-4xl font-semibold tracking-tight">About KreateSpace</h1>
      <p className="mt-5 text-lg text-ink-muted">
        KreateSpace is where people in Kenya discover creative businesses — the bakers, designers,
        photographers, makeup artists, decorators and florists behind the work they love.
      </p>
      <div className="mt-8 space-y-6 text-ink-muted">
        <p>
          Browse the work first. When something catches your eye, you’ll see exactly who made it and
          where they’re based, and you can reach them directly on their own website or WhatsApp.
          KreateSpace doesn’t sit in the middle of your conversation or take payments.
        </p>
        <p>
          Every business on KreateSpace is reviewed by our team before it appears, and changes to a
          public profile are reviewed too. During our pilot, businesses join by invitation.
        </p>
        <p>
          Anyone can browse without an account. You only need one to save creations you want to come
          back to.
        </p>
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          to="/explore"
          className="rounded-full bg-terracotta px-5 py-2.5 font-medium text-white hover:bg-terracotta-dark"
        >
          Explore creations
        </Link>
        <Link
          to="/for-businesses"
          className="rounded-full border border-ink-muted/40 bg-white px-5 py-2.5 font-medium hover:bg-cream"
        >
          For businesses
        </Link>
      </div>
    </main>
  );
}
