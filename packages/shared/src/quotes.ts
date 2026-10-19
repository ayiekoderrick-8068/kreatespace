// Kept apart from the quote form's validation (inquiries.ts), so a creation page can decide whether
// to offer the form without downloading the validation library first.

/** Categories where customers often want a tailored quote rather than a ready-made item. */
export const QUOTE_CATEGORY_SLUGS = ["photography", "event-decor"] as const;

export function supportsQuoteRequests(categorySlug: string): boolean {
  return (QUOTE_CATEGORY_SLUGS as readonly string[]).includes(categorySlug);
}
