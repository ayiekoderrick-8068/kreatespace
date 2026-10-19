import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@kreatespace/shared";

export function HomePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{PLATFORM_NAME}</h1>
      <p className="mt-3 text-lg text-terracotta">{PLATFORM_TAGLINE}</p>
      <p className="mt-6 max-w-prose text-ink-muted">
        Discover Kenyan creative businesses, explore their work, and connect with them directly.
      </p>
    </main>
  );
}
