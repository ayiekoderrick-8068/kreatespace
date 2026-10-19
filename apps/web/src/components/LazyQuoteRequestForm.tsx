import { Suspense, lazy, type ComponentProps } from "react";

// The quote form brings the form and validation libraries with it, and only photography and décor
// businesses show it, so the rest of the site should not download it.
const QuoteRequestForm = lazy(async () => ({
  default: (await import("./QuoteRequestForm")).QuoteRequestForm,
}));

export function LazyQuoteRequestForm(props: ComponentProps<typeof QuoteRequestForm>) {
  return (
    <Suspense fallback={<div className="skeleton h-12 w-full rounded-md" aria-hidden="true" />}>
      <QuoteRequestForm {...props} />
    </Suspense>
  );
}
