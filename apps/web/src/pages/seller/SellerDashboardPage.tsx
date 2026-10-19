import { Link } from "react-router";
import { FormMessage } from "../../components/forms";
import { StatusBadge } from "../../components/StatusBadge";
import { useOwnBusiness } from "../../lib/queries";
import type { DecisionView, OwnBusiness, RevisionView } from "../../lib/types";

const dateFormat = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" });

const ACTION_LABELS: Record<DecisionView["action"], string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
  REINSTATED: "Reinstated",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-cream-dark bg-white p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function latestDecision(decisions: DecisionView[], ...actions: DecisionView["action"][]) {
  return decisions.find((d) => actions.includes(d.action));
}

function Feedback({ decision }: { decision: DecisionView | undefined }) {
  if (!decision?.reason) return null;
  return (
    <blockquote className="mt-3 rounded-md border-l-4 border-terracotta bg-cream p-3 text-sm">
      <p className="font-medium">Feedback from our team</p>
      <p className="mt-1 whitespace-pre-line">{decision.reason}</p>
    </blockquote>
  );
}

function ProfileOverview({ revision, slug }: { revision: RevisionView; slug: string }) {
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="font-medium">Business</dt>
        <dd className="text-ink-muted">{revision.businessName}</dd>
      </div>
      <div>
        <dt className="font-medium">Category</dt>
        <dd className="text-ink-muted">{revision.category.name}</dd>
      </div>
      <div>
        <dt className="font-medium">Location</dt>
        <dd className="text-ink-muted">
          {revision.city}, {revision.county}
        </dd>
      </div>
      <div>
        <dt className="font-medium">WhatsApp</dt>
        <dd className="text-ink-muted">{revision.whatsappNumber}</dd>
      </div>
      <div>
        <dt className="font-medium">Website</dt>
        <dd className="text-ink-muted">
          {revision.websiteUrl ? (
            <a
              href={revision.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-terracotta underline"
            >
              {revision.websiteUrl}
            </a>
          ) : (
            "No website"
          )}
        </dd>
      </div>
      <div>
        <dt className="font-medium">Public page</dt>
        <dd>
          <Link to={`/businesses/${slug}`} className="text-terracotta underline">
            /businesses/{slug}
          </Link>
        </dd>
      </div>
    </dl>
  );
}

function ApprovedView({ data }: { data: OwnBusiness }) {
  const published = data.publishedRevision ?? data.revision;
  const hasUpdate = data.publishedRevision !== null;
  const update = data.revision;

  return (
    <>
      <Card title="Your public profile">
        <p className="mb-4 text-sm text-ink-muted">
          This is what customers see on KreateSpace right now.
        </p>
        <ProfileOverview revision={published} slug={data.business.slug} />
        <Link
          to="/seller/edit"
          className="mt-5 inline-block rounded-md bg-terracotta px-4 py-2.5 font-medium text-white hover:bg-terracotta-dark"
        >
          {hasUpdate && ["DRAFT", "CHANGES_REQUESTED"].includes(update.status)
            ? "Continue editing your update"
            : "Edit profile"}
        </Link>
      </Card>

      {hasUpdate ? (
        <Card title="Profile update">
          <p className="flex items-center gap-2 text-sm">
            Status: <StatusBadge status={update.status} />
          </p>
          {update.status === "PENDING" ? (
            <p className="mt-2 text-sm text-ink-muted">
              Your changes are waiting for review. Your current profile stays live until they’re
              approved.
            </p>
          ) : null}
          {update.status === "CHANGES_REQUESTED" ? (
            <Feedback decision={latestDecision(data.decisions, "CHANGES_REQUESTED")} />
          ) : null}
          {update.status === "REJECTED" ? (
            <>
              <p className="mt-2 text-sm text-ink-muted">
                These changes were not approved and have not been published. Your current profile is
                unchanged.
              </p>
              <Feedback decision={latestDecision(data.decisions, "REJECTED")} />
            </>
          ) : null}
          {update.status === "DRAFT" ? (
            <p className="mt-2 text-sm text-ink-muted">
              You have unsent changes. Submit them for review when you’re ready.
            </p>
          ) : null}
        </Card>
      ) : null}

      <Card title="Creations">
        <p className="text-sm text-ink-muted">
          Managing your creations (cakes, outfits, photo shoots and more) is coming soon. For now,
          your approved profile is live.
        </p>
      </Card>
    </>
  );
}

export function SellerDashboardPage() {
  const own = useOwnBusiness();

  if (own.isPending) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10" role="status">
        Loading…
      </main>
    );
  }
  if (own.isError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <FormMessage kind="error">We couldn’t load your dashboard. Please try again.</FormMessage>
      </main>
    );
  }

  const data = own.data;
  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Seller dashboard</h1>
        <div className="mt-6">
          <Card title="Register your business">
            <p className="text-sm text-ink-muted">
              You’ve been invited to sell on KreateSpace. Tell us about your business — our team
              reviews every application before it goes live.
            </p>
            <Link
              to="/seller/register"
              className="mt-4 inline-block rounded-md bg-terracotta px-4 py-2.5 font-medium text-white hover:bg-terracotta-dark"
            >
              Start your application
            </Link>
          </Card>
        </div>
      </main>
    );
  }

  const { business, revision, decisions } = data;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{revision.businessName}</h1>
        <StatusBadge status={business.status} />
      </div>

      <div className="mt-6 space-y-5">
        {business.status === "DRAFT" ? (
          <Card title="Finish your application">
            <p className="text-sm text-ink-muted">
              Your application hasn’t been sent yet. Complete the remaining steps and submit it for
              review.
            </p>
            <Link
              to="/seller/register"
              className="mt-4 inline-block rounded-md bg-terracotta px-4 py-2.5 font-medium text-white hover:bg-terracotta-dark"
            >
              Continue application
            </Link>
          </Card>
        ) : null}

        {business.status === "PENDING" ? (
          <Card title="We’re reviewing your application">
            <p className="text-sm text-ink-muted">
              Thanks for applying
              {revision.submittedAt
                ? ` on ${dateFormat.format(new Date(revision.submittedAt))}`
                : ""}
              . Our team checks every business before it appears on KreateSpace. We’ll show the
              decision here.
            </p>
          </Card>
        ) : null}

        {business.status === "CHANGES_REQUESTED" ? (
          <Card title="Changes needed">
            <p className="text-sm text-ink-muted">
              Our team asked for a few changes before approving your application.
            </p>
            <Feedback decision={latestDecision(decisions, "CHANGES_REQUESTED")} />
            <Link
              to="/seller/register"
              className="mt-4 inline-block rounded-md bg-terracotta px-4 py-2.5 font-medium text-white hover:bg-terracotta-dark"
            >
              Update your application
            </Link>
          </Card>
        ) : null}

        {business.status === "REJECTED" ? (
          <Card title="Application not approved">
            <p className="text-sm text-ink-muted">
              We’re sorry — your application wasn’t approved, so your business is not public.
            </p>
            <Feedback decision={latestDecision(decisions, "REJECTED")} />
          </Card>
        ) : null}

        {business.status === "SUSPENDED" ? (
          <Card title="Your business is suspended">
            <p className="text-sm text-ink-muted">
              Your profile is hidden from customers and can’t be edited right now.
            </p>
            <Feedback decision={latestDecision(decisions, "SUSPENDED")} />
          </Card>
        ) : null}

        {business.status === "APPROVED" ? <ApprovedView data={data} /> : null}

        {decisions.length > 0 ? (
          <Card title="Review history">
            <ul className="space-y-3 text-sm">
              {decisions.map((decision) => (
                <li key={decision.id}>
                  <span className="font-medium">{ACTION_LABELS[decision.action]}</span>
                  <span className="text-ink-muted">
                    {" "}
                    · {dateFormat.format(new Date(decision.createdAt))}
                  </span>
                  {decision.reason ? (
                    <p className="mt-0.5 text-ink-muted">{decision.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
