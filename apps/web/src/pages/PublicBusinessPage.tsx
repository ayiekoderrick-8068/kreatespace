import {
  buildWhatsAppLink,
  isSafeWebUrl,
  packageInquiryMessage,
  profileInquiryMessage,
  supportsQuoteRequests,
} from "@kreatespace/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Masonry, Photo } from "../components/gallery";
import { LazyQuoteRequestForm } from "../components/LazyQuoteRequestForm";
import { ApiError, apiRequest } from "../lib/api";
import { trackEvent, useTrackView } from "../lib/events";
import { usePageMeta, summarize } from "../lib/page-meta";
import { queryKeys } from "../lib/queries";
import type { PublicBusiness } from "../lib/types";

export function PublicBusinessPage() {
  const { slug = "" } = useParams();

  const result = useQuery({
    queryKey: queryKeys.publicBusiness(slug),
    queryFn: async () =>
      (
        await apiRequest<{ business: PublicBusiness }>(
          `/api/public/businesses/${encodeURIComponent(slug)}`,
        )
      ).business,
  });
  const business = result.data;
  useTrackView(
    business ? `business:${slug}` : null,
    business ? { type: "BUSINESS_VIEW", businessSlug: slug } : null,
  );

  usePageMeta(
    business
      ? {
          title: business.businessName,
          description: summarize(
            `${business.description} ${business.category.name} in ${business.city}, ${business.county}.`,
          ),
          canonicalPath: `/businesses/${slug}`,
        }
      : null,
  );

  if (result.isPending) {
    return (
      // Roughly the height of the finished page, so the footer starts below the screen and does
      // not jump down when the content arrives.
      <main
        className="mx-auto min-h-[90svh] max-w-4xl px-4 py-8"
        role="status"
        aria-label="Loading business"
      >
        <div className="skeleton h-8 w-2/3 rounded" />
        <div className="skeleton mt-4 h-4 w-full rounded" />
        <div className="skeleton mt-2 h-4 w-5/6 rounded" />
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="skeleton aspect-[4/5] rounded-2xl" />
          <div className="skeleton aspect-[4/5] rounded-2xl" />
          <div className="skeleton hidden aspect-[4/5] rounded-2xl md:block" />
        </div>
        <p className="sr-only">Loading…</p>
      </main>
    );
  }

  if (result.isError || !business) {
    const missing = result.error instanceof ApiError && result.error.status === 404;
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">
          {missing ? "Business not found" : "Something went wrong"}
        </h1>
        <p className="mt-3 text-ink-muted">
          {missing
            ? "We couldn’t find this business. It may not be listed on KreateSpace."
            : "We couldn’t load this page. Please try again."}
        </p>
        <Link to="/" className="mt-6 inline-block font-medium text-terracotta underline">
          Back to home
        </Link>
      </main>
    );
  }

  const whatsappLink = buildWhatsAppLink(
    business.whatsappNumber,
    profileInquiryMessage(business.businessName),
  );
  const websiteUrl =
    business.websiteUrl && isSafeWebUrl(business.websiteUrl) ? business.websiteUrl : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {business.logoUrl ? (
          <img
            src={business.logoUrl}
            alt={`${business.businessName} logo`}
            className="h-20 w-20 rounded-full border border-cream-dark object-cover"
          />
        ) : null}
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{business.businessName}</h1>
          <p className="mt-1 text-ink-muted">
            {business.city}, {business.county}
          </p>
          <ul aria-label="Categories" className="mt-2 flex flex-wrap gap-2 text-sm">
            {business.categories.map((category) => (
              <li key={category.slug}>
                <Link
                  to={`/explore?category=${category.slug}`}
                  className="rounded-full border border-sand bg-white px-3 py-1 hover:bg-cream-dark"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap gap-3">
        {whatsappLink ? (
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackEvent({ type: "WHATSAPP_CLICK", businessSlug: slug, source: "business_page" })
            }
            className="rounded-md bg-terracotta px-5 py-2.5 font-medium text-white hover:bg-terracotta-dark focus:outline-2 focus:outline-offset-2 focus:outline-terracotta"
          >
            Message on WhatsApp
          </a>
        ) : null}
        {websiteUrl ? (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackEvent({ type: "WEBSITE_CLICK", businessSlug: slug, source: "business_page" })
            }
            className="rounded-md border border-ink-muted/40 bg-white px-5 py-2.5 font-medium hover:bg-cream focus:outline-2 focus:outline-offset-2 focus:outline-terracotta"
          >
            Visit website
          </a>
        ) : null}
      </div>

      {whatsappLink && business.categories.some((c) => supportsQuoteRequests(c.slug)) ? (
        <div className="mt-4">
          <LazyQuoteRequestForm
            businessName={business.businessName}
            whatsappNumber={business.whatsappNumber}
            pageUrl={`${window.location.origin}/businesses/${slug}`}
            onOpen={() =>
              trackEvent({ type: "WHATSAPP_CLICK", businessSlug: slug, source: "quote" })
            }
          />
        </div>
      ) : null}

      <section aria-labelledby="about" className="mt-8">
        <h2 id="about" className="text-lg font-semibold">
          About
        </h2>
        <p className="mt-2 max-w-prose whitespace-pre-line text-ink-muted">
          {business.description}
        </p>
      </section>

      {business.packages.length > 0 ? (
        <section aria-labelledby="packages" className="mt-10">
          <h2 id="packages" className="text-lg font-semibold">
            Service packages
          </h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            {business.packages.map((pkg) => {
              const link = buildWhatsAppLink(
                business.whatsappNumber,
                packageInquiryMessage(
                  business.businessName,
                  pkg.name,
                  `${window.location.origin}/businesses/${slug}`,
                ),
              );
              return (
                <li key={pkg.id} className="rounded-2xl border border-sand bg-white p-5">
                  {pkg.image?.url ? (
                    <div className="mb-3 overflow-hidden rounded-xl">
                      <Photo
                        image={pkg.image}
                        alt={`${pkg.name} photo`}
                        allowRetry={false}
                        sizes="400px"
                      />
                    </div>
                  ) : null}
                  <h3 className="text-lg font-semibold">{pkg.name}</h3>
                  {pkg.startingPriceKes ? (
                    <p className="mt-0.5 text-sm font-medium text-terracotta">
                      From KSh {new Intl.NumberFormat("en-KE").format(pkg.startingPriceKes)}
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm text-ink-muted">{pkg.description}</p>
                  <ul className="mt-3 list-inside list-disc text-sm text-ink-muted">
                    {pkg.includes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        trackEvent({
                          type: "WHATSAPP_CLICK",
                          businessSlug: slug,
                          packageId: pkg.id,
                          source: "package",
                        })
                      }
                      className="mt-4 inline-block rounded-full bg-terracotta px-5 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
                    >
                      Ask about this package
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {business.creations.length > 0 ? (
        <section aria-labelledby="creations" className="mt-10">
          <h2 id="creations" className="text-lg font-semibold">
            Their work
          </h2>
          <div className="mt-3">
            <Masonry items={business.creations} />
          </div>
          {business.hasMoreCreations ? (
            <p className="mt-4 text-sm text-ink-muted">
              Showing their {business.creations.length} newest creations.
            </p>
          ) : null}
        </section>
      ) : null}

      {business.images.length > 0 ? (
        <section aria-labelledby="portfolio" className="mt-8">
          <h2 id="portfolio" className="text-lg font-semibold">
            Portfolio
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {business.images.map((image, index) => (
              <li key={image.url}>
                <img
                  src={image.url}
                  alt={`${business.businessName} portfolio photo ${index + 1}`}
                  loading="lazy"
                  className="aspect-square w-full rounded-lg object-cover"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
