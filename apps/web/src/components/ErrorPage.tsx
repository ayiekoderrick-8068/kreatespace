import { Component, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";

function describe(error: unknown): { name: string; message: string } {
  if (error instanceof Error)
    return { name: error.name, message: error.message.split("\n").pop() ?? "" };
  return { name: typeof error, message: "" };
}

/** Shown when something unexpected breaks while drawing a page. Never shows technical detail. */
export function CrashMessage({ missing = false }: { missing?: boolean }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">
        {missing ? "We couldn’t find that page" : "Something went wrong"}
      </h1>
      <p className="mt-3 text-ink-muted">
        {missing
          ? "The address may be mistyped, or the page may have moved."
          : "That wasn’t supposed to happen. Your work is safe. Try loading the page again."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {missing ? null : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-terracotta px-4 py-2.5 font-medium text-white hover:bg-terracotta-dark"
          >
            Try again
          </button>
        )}
        <a
          href="/"
          className="rounded-md border border-ink-muted/40 bg-white px-4 py-2.5 font-medium hover:bg-cream"
        >
          Go to the home page
        </a>
      </div>
    </main>
  );
}

/** The router's error page: a friendly message in place of its default technical screen. */
export function RouteErrorPage() {
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  // Written to the visitor's own browser console only, for whoever helps them.
  if (!missing) console.error("Page crashed", describe(error));
  return <CrashMessage missing={missing} />;
}

/** Catches crashes outside the router (such as in sign-in setup) so visitors never see a blank page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error("App crashed", describe(error));
  }

  override render() {
    return this.state.failed ? <CrashMessage /> : this.props.children;
  }
}
