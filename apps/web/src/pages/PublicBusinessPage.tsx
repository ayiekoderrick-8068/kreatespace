import { buildWhatsAppLink, isSafeWebUrl, profileInquiryMessage } from "@kreatespace/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { Masonry } from "../components/gallery";
import { ApiError, apiRequest } from "../lib/api";
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

  useEffect(() => {
    if (business) document.title = `${business.businessName} — KreateSpace`;
  }, [business]);

  if (result.isPending) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12" role="status">
        Loading…
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
            className="rounded-md border border-ink-muted/40 bg-white px-5 py-2.5 font-medium hover:bg-cream focus:outline-2 focus:outline-offset-2 focus:outline-terracotta"
          >
            Visit website
          </a>
        ) : null}
      </div>

      <section aria-labelledby="about" className="mt-8">
        <h2 id="about" className="text-lg font-semibold">
          About
        </h2>
        <p className="mt-2 max-w-prose whitespace-pre-line text-ink-muted">
          {business.description}
        </p>
      </section>

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
