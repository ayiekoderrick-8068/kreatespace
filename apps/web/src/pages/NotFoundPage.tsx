import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="mt-3 text-ink-muted">We couldn’t find the page you were looking for.</p>
      <Link
        to="/"
        className="mt-6 rounded-md bg-terracotta px-5 py-2.5 font-medium text-white hover:bg-terracotta-dark focus:outline-2 focus:outline-offset-2 focus:outline-terracotta"
      >
        Back to discovery
      </Link>
    </main>
  );
}
