import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRightIcon, SearchIcon } from "../components/icons";
import { FormMessage } from "../components/forms";
import { GallerySkeleton, Masonry, Photo } from "../components/gallery";
import { useHome } from "../lib/queries";
import type { HomeData } from "../lib/types";

const STEPS = [
  {
    title: "Discover",
    body: "Browse fresh work from Kenyan creative businesses, or search for exactly what you have in mind.",
  },
  {
    title: "Explore",
    body: "Open a creation to see more photos, learn who made it and where they’re based.",
  },
  {
    title: "Connect",
    body: "Message the creator directly on WhatsApp or visit their website. No middleman.",
  },
];

function Hero({ recent }: { recent: HomeData["recent"] }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const collage = recent.filter((creation) => creation.image?.url).slice(0, 4);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const q = text.trim();
    navigate(q ? `/explore?q=${encodeURIComponent(q)}` : "/explore");
  }

  return (
    <section aria-labelledby="hero-heading" className="bg-cream-dark/50">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 md:grid-cols-2 md:py-16">
        <div>
          <h1
            id="hero-heading"
            className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            Discover creativity.
            <br />
            <span className="text-terracotta">Meet the creator.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-ink-muted">
            Cakes, fashion, photography, makeup, décor and gifts from Kenyan creative businesses —
            then message the maker directly.
          </p>
          <form onSubmit={onSubmit} role="search" className="mt-7 max-w-xl">
            <label htmlFor="hero-search" className="sr-only">
              Search creations
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
              <input
                id="hero-search"
                type="search"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Search “birthday cakes”, “bridal makeup”…"
                enterKeyHint="search"
                className="w-full rounded-full border border-sand bg-white py-3.5 pl-12 pr-28 text-base shadow-sm"
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-terracotta px-5 py-2 text-sm font-medium text-white hover:bg-terracotta-dark"
              >
                Search
              </button>
            </div>
          </form>
        </div>

        {collage.length > 0 ? (
          <ul aria-label="Recent creations" className="grid grid-cols-2 gap-3">
            {collage.map((creation, index) => (
              <li key={creation.id} className={index % 2 === 1 ? "mt-6" : ""}>
                <Link
                  to={`/creations/${creation.id}`}
                  aria-label={creation.title}
                  className="block overflow-hidden rounded-2xl"
                >
                  <Photo image={creation.image} alt={creation.title} eager allowRetry={false} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div
            aria-hidden="true"
            className="hidden rounded-3xl bg-terracotta/10 p-10 text-center font-display text-2xl leading-relaxed text-terracotta md:block"
          >
            Cakes · Fashion · Beauty
            <br />
            Photography · Event Decor
            <br />
            Flowers · Creative Gifts
          </div>
        )}
      </div>
    </section>
  );
}

function Categories({ categories }: { categories: HomeData["categories"] }) {
  return (
    <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-12">
      <h2 id="categories-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Browse by category
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
        {categories
          .filter((category) => category.slug !== "other")
          .map((category) => (
            <li key={category.slug}>
              <Link
                to={`/explore?category=${category.slug}`}
                className="group block overflow-hidden rounded-2xl border border-sand bg-white transition-shadow hover:shadow-md"
              >
                {category.cover?.url ? (
                  <Photo
                    image={{ ...category.cover, width: 1, height: 1 }}
                    alt=""
                    allowRetry={false}
                    className="transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-cream-dark font-display text-3xl text-terracotta/60">
                    {category.name.slice(0, 1)}
                  </div>
                )}
                <div className="p-3">
                  <p className="font-medium">{category.name}</p>
                  {category.count > 0 ? (
                    <p className="text-xs text-ink-muted">
                      {category.count} {category.count === 1 ? "creation" : "creations"}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}

function Recent({ recent }: { recent: HomeData["recent"] }) {
  return (
    <section aria-labelledby="recent-heading" className="mx-auto max-w-7xl px-4 py-12">
      <div className="flex items-end justify-between gap-4">
        <h2 id="recent-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Recently published
        </h2>
        {recent.length > 0 ? (
          <Link
            to="/explore"
            className="flex items-center gap-1 text-sm font-medium text-terracotta"
          >
            Explore all <ArrowRightIcon className="h-4 w-4" />
          </Link>
        ) : null}
      </div>
      <div className="mt-6">
        {recent.length > 0 ? (
          <Masonry items={recent} eagerCount={0} />
        ) : (
          <div className="rounded-2xl border border-sand bg-white p-8 text-center">
            <h3 className="text-lg font-semibold">New creations are on their way</h3>
            <p className="mt-2 text-ink-muted">
              Businesses are being reviewed before they appear. Check back soon.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Creators({ businesses }: { businesses: HomeData["businesses"] }) {
  if (businesses.length === 0) return null;
  return (
    <section aria-labelledby="creators-heading" className="bg-cream-dark/50">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <h2 id="creators-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Meet the creators
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((business) => (
            <li key={business.slug}>
              <Link
                to={`/businesses/${business.slug}`}
                className="block rounded-2xl border border-sand bg-white p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  {business.logoUrl ? (
                    <img
                      src={business.logoUrl}
                      alt=""
                      loading="lazy"
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
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg font-semibold">{business.name}</p>
                    <p className="truncate text-sm text-ink-muted">
                      {business.categoryName} · {business.city}, {business.county}
                    </p>
                  </div>
                </div>
                {business.previews.length > 0 ? (
                  <div className="mt-3 grid grid-cols-3 gap-2" aria-hidden="true">
                    {business.previews.map((preview, index) => (
                      <Photo
                        key={`${preview.url}-${index}`}
                        image={{ ...preview, width: 1, height: 1 }}
                        alt=""
                        allowRetry={false}
                        className="rounded-lg"
                      />
                    ))}
                  </div>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="mx-auto max-w-7xl px-4 py-12">
      <h2 id="how-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        How KreateSpace works
      </h2>
      <ol className="mt-6 grid gap-5 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-2xl border border-sand bg-white p-6">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-terracotta font-medium text-white"
            >
              {index + 1}
            </span>
            <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm text-ink-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BusinessCta() {
  return (
    <section aria-labelledby="cta-heading" className="mx-auto max-w-7xl px-4 pb-14">
      <div className="rounded-3xl bg-ink px-6 py-10 text-cream sm:px-12">
        <h2 id="cta-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Run a creative business?
        </h2>
        <p className="mt-3 max-w-xl text-cream/80">
          Get a free public profile and be discovered by people looking for exactly what you make.
          We’re welcoming businesses by invitation during our pilot.
        </p>
        <Link
          to="/for-businesses"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-terracotta px-6 py-3 font-medium text-white hover:bg-terracotta-dark"
        >
          Learn how to join <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

export function HomePage() {
  const home = useHome();

  return (
    <main>
      <Hero recent={home.data?.recent ?? []} />
      {home.isPending ? (
        <div className="mx-auto max-w-7xl px-4 py-12">
          <GallerySkeleton count={8} />
        </div>
      ) : home.isError ? (
        <div className="mx-auto max-w-7xl px-4 py-12">
          <FormMessage kind="error">
            We couldn’t load the latest creations. You can still{" "}
            <Link to="/explore" className="font-medium underline">
              explore all creations
            </Link>
            .
          </FormMessage>
        </div>
      ) : (
        <>
          <Categories categories={home.data.categories} />
          <Recent recent={home.data.recent} />
          <Creators businesses={home.data.businesses} />
        </>
      )}
      <HowItWorks />
      <BusinessCta />
    </main>
  );
}
