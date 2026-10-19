import {
  buildWhatsAppLink,
  creationInquiryMessage,
  isSafeWebUrl,
  supportsQuoteRequests,
} from "@kreatespace/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { FormMessage, SecondaryButton } from "../components/forms";
import { GallerySkeleton, Masonry, Photo } from "../components/gallery";
import { QuoteRequestForm } from "../components/QuoteRequestForm";
import { SaveButton } from "../components/SaveButton";
import { ApiError } from "../lib/api";
import { trackEvent, useTrackView } from "../lib/events";
import { useCreation, useRelatedCreations } from "../lib/queries";

function BackToExplore() {
  return (
    <Link to="/explore" className="text-sm font-medium text-terracotta underline">
      ← Explore
    </Link>
  );
}

export function CreationPage() {
  const { id = "" } = useParams();
  const creation = useCreation(id);
  const related = useRelatedCreations(id, Boolean(creation.data));
  useTrackView(
    creation.data ? `creation:${id}` : null,
    creation.data ? { type: "CREATION_VIEW", creationId: id } : null,
  );
  const [selected, setSelected] = useState(0);

  const title = creation.data?.title;
  useEffect(() => {
    if (title) document.title = `${title} — KreateSpace`;
  }, [title]);

  if (creation.isPending) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8" role="status" aria-label="Loading creation">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="skeleton aspect-[4/5] w-full rounded-2xl" />
          <div className="space-y-4">
            <div className="skeleton h-8 w-3/4 rounded" />
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-5/6 rounded" />
          </div>
        </div>
      </main>
    );
  }

  if (creation.isError) {
    const missing =
      creation.error instanceof ApiError && [400, 404].includes(creation.error.status);
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">
          {missing ? "Creation not found" : "Something went wrong"}
        </h1>
        <p className="mt-3 text-ink-muted">
          {missing
            ? "This creation isn’t available. It may have been removed."
            : "We couldn’t load this creation. Please try again."}
        </p>
        <div className="mt-6 flex justify-center gap-4">
          {missing ? null : (
            <SecondaryButton type="button" onClick={() => void creation.refetch()}>
              Try again
            </SecondaryButton>
          )}
          <Link to="/explore" className="self-center font-medium text-terracotta underline">
            Back to Explore
          </Link>
        </div>
      </main>
    );
  }

  const data = creation.data;
  const { business } = data;
  const current = data.images[Math.min(selected, data.images.length - 1)] ?? null;

  const creationUrl = `${window.location.origin}/creations/${data.id}`;
  const whatsappLink = buildWhatsAppLink(
    business.whatsappNumber,
    creationInquiryMessage(business.name, data.title, creationUrl),
  );
  const websiteUrl =
    business.websiteUrl && isSafeWebUrl(business.websiteUrl) ? business.websiteUrl : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
      <BackToExplore />

      <div className="mt-4 grid gap-8 md:grid-cols-2 md:gap-10">
        <section aria-label="Photos">
          <div className="overflow-hidden rounded-2xl bg-cream-dark">
            <Photo
              image={current}
              alt={`${data.title} by ${business.name}`}
              eager
              fit="contain"
              sizes="(min-width: 768px) 50vw, 100vw"
              className="max-h-[80vh]"
            />
          </div>
          {data.images.length > 1 ? (
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="More photos">
              {data.images.map((image, index) => (
                <li key={`${image.url}-${index}`} className="w-20 shrink-0">
                  <button
                    type="button"
                    aria-label={`Show photo ${index + 1} of ${data.images.length}`}
                    aria-current={index === selected ? "true" : undefined}
                    onClick={() => setSelected(index)}
                    className={`block w-full overflow-hidden rounded-lg border-2 ${
                      index === selected ? "border-terracotta" : "border-transparent"
                    }`}
                  >
                    <Photo image={image} alt="" fit="cover" allowRetry={false} sizes="80px" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section aria-label="Details">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {data.title}
          </h1>
          <p className="mt-3 flex flex-wrap gap-2 text-sm">
            <Link
              to={`/explore?category=${data.category.slug}`}
              className="rounded-full border border-sand bg-white px-3 py-1 hover:bg-cream-dark"
            >
              {data.category.name}
            </Link>
            {data.occasion ? (
              <Link
                to={`/explore?occasion=${data.occasion.slug}`}
                className="rounded-full border border-sand bg-white px-3 py-1 hover:bg-cream-dark"
              >
                {data.occasion.name}
              </Link>
            ) : null}
          </p>
          <p className="mt-5 max-w-prose whitespace-pre-line text-ink-muted">{data.description}</p>
          <div className="mt-5">
            <SaveButton creationId={data.id} title={data.title} variant="button" />
          </div>

          <section
            aria-label="About the business"
            className="mt-8 rounded-2xl border border-sand bg-white p-5"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Made by</p>
            <div className="mt-2 flex items-center gap-3">
              {business.logoUrl ? (
                <img
                  src={business.logoUrl}
                  alt=""
                  className="h-12 w-12 rounded-full border border-sand object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-cream-dark font-display text-lg font-semibold"
                >
                  {business.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div>
                <Link
                  to={`/businesses/${business.slug}`}
                  className="font-display text-lg font-semibold hover:underline"
                >
                  {business.name}
                </Link>
                <p className="text-sm text-ink-muted">
                  {business.city}, {business.county}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {whatsappLink ? (
                <a
                  href={whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    trackEvent({
                      type: "WHATSAPP_CLICK",
                      businessSlug: business.slug,
                      creationId: data.id,
                      source: "creation_page",
                    })
                  }
                  className="rounded-full bg-terracotta px-5 py-2.5 font-medium text-white hover:bg-terracotta-dark"
                >
                  Enquire on WhatsApp
                </a>
              ) : null}
              {websiteUrl ? (
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    trackEvent({
                      type: "WEBSITE_CLICK",
                      businessSlug: business.slug,
                      creationId: data.id,
                      source: "creation_page",
                    })
                  }
                  className="rounded-full border border-ink-muted/40 bg-white px-5 py-2.5 font-medium hover:bg-cream"
                >
                  Visit website
                </a>
              ) : null}
              <Link
                to={`/businesses/${business.slug}`}
                className="rounded-full border border-ink-muted/40 bg-white px-5 py-2.5 font-medium hover:bg-cream"
              >
                View all their work
              </Link>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              You’ll be taken to the seller’s own WhatsApp or website. Ask them directly about
              pricing and availability.
            </p>
            {whatsappLink && supportsQuoteRequests(data.category.slug) ? (
              <div className="mt-4 border-t border-sand pt-4">
                <p className="mb-3 text-sm text-ink-muted">
                  Need something tailored? Share the details and we’ll prepare a message for you.
                </p>
                <QuoteRequestForm
                  businessName={business.name}
                  whatsappNumber={business.whatsappNumber}
                  subject={data.title}
                  defaultServiceType={data.category.name}
                  pageUrl={creationUrl}
                  onOpen={() =>
                    trackEvent({
                      type: "WHATSAPP_CLICK",
                      businessSlug: business.slug,
                      creationId: data.id,
                      source: "quote",
                    })
                  }
                />
              </div>
            ) : null}
          </section>
        </section>
      </div>

      <section aria-labelledby="related-heading" className="mt-14">
        {related.isPending ? (
          <>
            <h2 id="related-heading" className="text-2xl font-semibold">
              You might also like
            </h2>
            <div className="mt-4">
              <GallerySkeleton count={4} />
            </div>
          </>
        ) : related.isError ? (
          <FormMessage kind="info">We couldn’t load similar creations just now.</FormMessage>
        ) : related.data.length > 0 ? (
          <>
            <h2 id="related-heading" className="text-2xl font-semibold">
              You might also like
            </h2>
            <div className="mt-4">
              <Masonry items={related.data} eagerCount={0} />
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
